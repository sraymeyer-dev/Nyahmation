import { IDENTITY, multiply, type Mat2D } from '../../engine/math';

// Parses an SVG `transform` attribute, e.g. "translate(10 20) rotate(45)".

export function parseTransform(text: string | null | undefined): Mat2D {
  if (!text) return IDENTITY;
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const args = (match[2]!.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    const [a = 0, b, c, d, e, f] = args;
    let next: Mat2D = IDENTITY;
    switch (match[1]) {
      case 'matrix':
        if (args.length === 6) next = [a, b!, c!, d!, e!, f!];
        break;
      case 'translate':
        next = [1, 0, 0, 1, a, b ?? 0];
        break;
      case 'scale':
        next = [a, 0, 0, b ?? a, 0, 0];
        break;
      case 'rotate': {
        const r = (a * Math.PI) / 180;
        const rot: Mat2D = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        next = b !== undefined && c !== undefined ? multiply(multiply([1, 0, 0, 1, b, c], rot), [1, 0, 0, 1, -b, -c]) : rot;
        break;
      }
      case 'skewX':
        next = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        next = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, next);
  }
  return m;
}

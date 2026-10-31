import { correction, generate } from 'lean-qr';

// A QR code as SVG (lean-qr 2.7.4, MIT, no dependencies: docs/decisions.md entry 22). Error
// correction M, so a code photographed off a phone screen still scans. Dark on white with a
// four-module quiet zone: scanners expect it, and many fail on light-on-dark codes. Built with
// createElementNS; the only attributes set are numbers.

const SVG = 'http://www.w3.org/2000/svg';
const QUIET = 4;

export function qrSvg(text: string, label: string): SVGSVGElement {
  const code = generate(text, { minCorrectionLevel: correction.M });
  const side = code.size + QUIET * 2;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${side} ${side}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('class', 'al-qr');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const name = document.createElementNS(SVG, 'title');
  name.textContent = label;
  const paper = document.createElementNS(SVG, 'rect');
  for (const [k, v] of [['width', side], ['height', side], ['fill', '#fff']] as const) paper.setAttribute(k, String(v));
  let d = '';
  for (let y = 0; y < code.size; y++) for (let x = 0; x < code.size; x++) if (code.get(x, y)) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
  const modules = document.createElementNS(SVG, 'path');
  modules.setAttribute('d', d);
  modules.setAttribute('fill', '#05070f');
  svg.append(name, paper, modules);
  return svg;
}

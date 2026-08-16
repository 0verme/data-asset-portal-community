const svgNs = "http://www.w3.org/2000/svg";

export function createSvgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(svgNs, name);
}

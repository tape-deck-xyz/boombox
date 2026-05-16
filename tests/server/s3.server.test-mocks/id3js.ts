/** Mock for id3js used by server tests that import shared file helpers. */
export function fromUrl(
  _url: string,
): Promise<{ images: { data: ArrayBuffer; mime: string }[] }> {
  return Promise.resolve({
    images: [{ data: new Uint8Array([1, 2, 3]).buffer, mime: "image/png" }],
  });
}

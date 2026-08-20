import path from 'path';

/**
 * Build the header that makes a browser save a file instead of displaying it.
 *
 * This is what makes a Download button download. Without the header the browser
 * decides for itself, and for the formats a repository is mostly made of — PDF,
 * PNG, JPG, MP4 — it decides to display: the click opened a tab showing the file
 * and nothing was ever saved. Only Content-Disposition changes that answer, and
 * only the server can send it, which is why this cannot be fixed in the page
 * alone: a link's `download` attribute is ignored the moment the file comes from
 * another origin, which is exactly the deployment case here.
 *
 * Two filenames go out. `filename` is plain ASCII for anything ancient, and is
 * stripped of the quote and backslash characters that would otherwise end the
 * header value early — a filename is user-supplied text arriving in a header, so
 * it is treated as such. `filename*` carries the real UTF-8 name (RFC 5987) and
 * is what every current browser actually uses, so an upload called
 * "ప్రవేశాలు.pdf" still saves under its own name.
 */

// Written by codepoint rather than as escapes so the intent survives being read:
// 0x22 is the double quote that closes a quoted header value, 0x5c the backslash
// that escapes within one.
const QUOTE = String.fromCharCode(0x22);
const BACKSLASH = String.fromCharCode(0x5c);

const asciiFallback = (name) => {
  const safe = Array.from(name)
    .map((ch) => {
      // Printable ASCII only: control characters could inject a second header,
      // and anything above 0x7e is not representable in a latin-1 header value.
      const printable = ch >= ' ' && ch <= '~';
      return printable && ch !== QUOTE && ch !== BACKSLASH ? ch : '_';
    })
    .join('')
    .trim();
  return safe || 'download';
};

/**
 * @param {string} requested  the name asked for, or '1'/'' to use the file's own
 * @param {string} filePath   the file being served, for the fallback name
 * @returns {string} a Content-Disposition value
 */
export function attachmentDisposition(requested, filePath) {
  const wanted = requested && requested !== '1' ? requested : path.basename(filePath);
  // basename() again on the requested name: a crafted ?download=../../etc/passwd
  // must not reach the header, and a path separator in a filename is meaningless
  // to a browser's save dialog anyway.
  const name = path.basename(String(wanted));
  return `attachment; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** @file Standalone registration file for custom elements.
 *
 * Registers common custom elements used by the app. If possible import needed
 * elements in the file/component that needs them. Import this (or the built
 * bundle that includes it) so the elements are defined. Registered elements:
 * - `<album-header-custom-element>`, `<album-image-custom-element>`
 * - `<nav-link>` — same-origin app navigation with fragment loading
 * - `<playbar-custom-element>`, `<track-info-custom-element>`
 * - `<site-footer-custom-element>` — subtle page footer
 * - `<tracklist-item-custom-element>`, `<upload-dialog-custom-element>`
 *
 * Can be imported directly in HTML or built with Deno bundle to `build/main.js`.
 */

import "./AlbumHeader/album-header-custom-element.ts";
import "./AlbumImage/album-image-custom-element.ts";
import "./NavLink/nav-link-custom-element.ts";
import "./Layout/PlayBar/playbar-custom-element.ts";
import "./Layout/PlayBar/track-info-custom-element.ts";
import "./Tracklist/tracklist-item-custom-element.ts";
import "./SiteFooter/site-footer-custom-element.ts";
import "./UploadDialog/upload-dialog-custom-element.ts";

/** @file Tests for blank slate HTML generator */
import { assertEquals, assertStringIncludes } from "@std/assert";
import blankSlateHtml from "./blank-slate-html.ts";

Deno.test("blankSlateHtml with isAdmin true includes admin copy and CTA", () => {
  const html = blankSlateHtml({ isAdmin: true });

  assertStringIncludes(html, "No albums yet");
  assertStringIncludes(html, "Upload your first album to get started.");
  assertStringIncludes(html, "blank-slate-cta");
  assertStringIncludes(html, "Upload album");
  assertStringIncludes(html, "musical-note-icon");
});

Deno.test("blankSlateHtml with isAdmin false includes non-admin copy and no CTA", () => {
  const html = blankSlateHtml({ isAdmin: false });

  assertStringIncludes(html, "Nothing here yet.");
  assertStringIncludes(html, "Check back later.");
  assertEquals(
    html.includes('id="blank-slate-upload"'),
    false,
    "non-admin should not have CTA button",
  );
  assertStringIncludes(html, "musical-note-icon");
});

Deno.test("blankSlateHtml includes role and aria-live for accessibility", () => {
  const html = blankSlateHtml({ isAdmin: true });

  assertStringIncludes(html, 'role="status"');
  assertStringIncludes(html, 'aria-live="polite"');
});

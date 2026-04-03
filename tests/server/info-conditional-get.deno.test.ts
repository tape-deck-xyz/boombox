/** @file Tests for GET /info conditional requests ({@link isIfNoneMatchSatisfied}). */
import { assertEquals } from "@std/assert";
import { isIfNoneMatchSatisfied } from "../../server/info.ts";

Deno.test("isIfNoneMatchSatisfied returns false without headers or etag", () => {
  assertEquals(isIfNoneMatchSatisfied(null, "a"), false);
  assertEquals(isIfNoneMatchSatisfied('"x"', undefined), false);
  assertEquals(isIfNoneMatchSatisfied('"x"', ""), false);
  assertEquals(isIfNoneMatchSatisfied(null, undefined), false);
});

Deno.test("isIfNoneMatchSatisfied matches quoted strong and weak ETags", () => {
  assertEquals(isIfNoneMatchSatisfied('"abc123"', "abc123"), true);
  assertEquals(isIfNoneMatchSatisfied('W/"abc123"', "abc123"), true);
  assertEquals(isIfNoneMatchSatisfied('"other", "abc123"', "abc123"), true);
  assertEquals(isIfNoneMatchSatisfied("*", "abc123"), true);
  assertEquals(isIfNoneMatchSatisfied('"nomatch"', "abc123"), false);
});

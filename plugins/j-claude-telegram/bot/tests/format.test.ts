import { test, expect } from "bun:test";
import { markdownToTelegramHtml as md } from "../format";

test("inline styles", () => {
  expect(md("**bold** and *it* and `x<y`")).toBe("<b>bold</b> and <i>it</i> and <code>x&lt;y</code>");
  expect(md("~~old~~ __strong__ _soft_")).toBe("<s>old</s> <b>strong</b> <i>soft</i>");
  expect(md("[site](https://example.com/a?b=1&c=2)")).toBe('<a href="https://example.com/a?b=1&amp;c=2">site</a>');
});

test("nothing from the text can become a tag", () => {
  expect(md("<script>alert(1)</script> & <b>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;");
  expect(md("`<b>`")).toBe("<code>&lt;b&gt;</code>");
});

test("snake_case, 2*3*4 and lone stars stay as they are", () => {
  expect(md("my_file_name.ts")).toBe("my_file_name.ts");
  expect(md("2*3*4 = 24")).toBe("2*3*4 = 24");
  expect(md("a * b")).toBe("a * b");
});

test("blocks: code, headings, bullets, quotes", () => {
  expect(md("```ts\nconst a = 1 < 2;\n```")).toBe('<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>');
  expect(md("## Plan")).toBe("<b>Plan</b>");
  expect(md("- one\n  * two")).toBe("• one\n  • two");
  expect(md("> a\n> b\nafter")).toBe("<blockquote>a\nb</blockquote>\nafter");
  expect(md("```\nno end")).toBe("```\nno end");
});

test("code inside a code block is not styled", () => {
  expect(md("```\n**not bold**\n```")).toBe("<pre><code>**not bold**</code></pre>");
});

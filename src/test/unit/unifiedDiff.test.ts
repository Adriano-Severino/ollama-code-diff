import * as assert from 'assert';
import { applyUnifiedDiffToContent, parseUnifiedDiff, sanitizeUnifiedDiff } from '../../utils/unifiedDiff';

suite('UnifiedDiff (unit)', () => {
  test('parses and applies a basic file patch', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
-const value = 1;
+const value = 2;
 console.log(value);
`;

    const files = parseUnifiedDiff(diff);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].newPath, 'src/app.ts');

    const original = 'const value = 1;\nconsole.log(value);\n';
    const updated = applyUnifiedDiffToContent(original, files[0]);
    assert.strictEqual(updated, 'const value = 2;\nconsole.log(value);\n');
  });

  test('supports fenced diff blocks', () => {
    const fenced = `\`\`\`diff
diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
+new
\`\`\``;

    const sanitized = sanitizeUnifiedDiff(fenced);
    assert.ok(sanitized.startsWith('diff --git a/file.txt b/file.txt'));

    const files = parseUnifiedDiff(fenced);
    const output = applyUnifiedDiffToContent('old\n', files[0]);
    assert.strictEqual(output, 'new\n');
  });

  test('handles creation of new files', () => {
    const diff = `diff --git a/new-file.ts b/new-file.ts
new file mode 100644
--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,2 @@
+export const created = true;
+console.log(created);
`;

    const files = parseUnifiedDiff(diff);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].isNewFile, true);
    assert.strictEqual(files[0].newPath, 'new-file.ts');

    const output = applyUnifiedDiffToContent('', files[0]);
    assert.strictEqual(output, 'export const created = true;\nconsole.log(created);\n');
  });

  test('marks deleted files correctly', () => {
    const diff = `diff --git a/obsolete.ts b/obsolete.ts
deleted file mode 100644
--- a/obsolete.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2
`;

    const files = parseUnifiedDiff(diff);
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].isDeletedFile, true);
    assert.strictEqual(files[0].oldPath, 'obsolete.ts');
  });

  test('throws when patch context does not match content', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-const a = 1;
+const a = 2;
`;

    const [file] = parseUnifiedDiff(diff);
    assert.throws(() => applyUnifiedDiffToContent('const b = 1;\n', file), /Conflito ao aplicar patch/);
  });
});

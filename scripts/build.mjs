import { build } from 'vite';

await build({
  base: './',
  build: { rollupOptions: { input: ['popup.html', 'preview.html'] } },
});

for (const [name, entry, format] of [
  ['content', 'src/content/index.tsx', 'iife'],
  ['background', 'src/background/index.ts', 'es'],
]) {
  await build({
    publicDir: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      emptyOutDir: false,
      lib: { entry, name: 'YuketangDdlHelper', formats: [format], fileName: () => name + '.js' },
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  });
}

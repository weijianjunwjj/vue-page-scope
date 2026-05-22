/**
 * Rollup 构建配置
 *
 * 两个产物:
 *   - dist/index.esm.js  (ESM,现代 bundler / Vite 默认使用)
 *   - dist/index.cjs.js  (CommonJS,Node 兼容 / 老 bundler)
 *
 * 没有 UMD —— Vue 3 生态(Pinia / Vue Router / VueUse)已不再发布 UMD,
 * UMD 是 ES Module 普及前的过渡产物.
 *
 * `vue` 始终外部化,不打包进产物 —— 由宿主应用提供.
 * 源码用 ES5+ 风格写(var / function),直接走 rollup,不需要 babel.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const banner = `/*!
 * vue-page-scope v${pkg.version}
 * (c) ${new Date().getFullYear()} weijianjun
 * @license MIT
 */`;

export default {
  input: 'src/index.js',
  external: ['vue'],
  output: [
    {
      file: 'dist/index.esm.js',
      format: 'es',
      banner,
    },
    {
      file: 'dist/index.cjs.js',
      format: 'cjs',
      exports: 'named',
      banner,
    },
  ],
};

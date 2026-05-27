/**
 * vue-page-scope 0.1.0 — TypeScript 类型定义
 *
 * 实用主义版:够用、够 IDE 提示,不做 Pinia 那种全推导.
 *
 * 核心导出:
 *   - definePageScope: 定义一个页面级 Scope
 *   - injectPageScope: 子组件中获取当前页面 Scope
 *   - registerPlugin:  注册全局 plugin
 *   - scopeRegistry:   导出的 Map,调试 / devtools 使用
 */

import type {
  reactive,
  computed,
  watch,
  effectScope,
} from 'vue';

type AnyRecord = Record<string, any>;

// ====== getter 返回值类型推导(readonly) ======
type GetterResults<G> = {
  readonly [K in keyof G]: G[K] extends (...args: any[]) => infer R ? R : never;
};

// ====== action 方法签名保留 ======
type ActionMethods<A> = {
  [K in keyof A]: A[K] extends (...args: infer P) => infer R
    ? (...args: P) => R
    : never;
};

// ====== Plugin install 第三参数 ======
// runtime context: 转发 Vue 3 响应式 API,不引入新概念.
// 设计原则:只暴露 plugin 真正会用到的能力,不做"看似跨版本"的伪适配层.
// 即使 plugin 跨 Vue 2 / Vue 3 工作,响应式 API 也必然不同,
// 通过 ctx.framework 分支处理比通过伪 ctx.set 假装一致更诚实.
export interface PageScopeRuntimeContext {
  framework: 'vue3';
  version: 3;
  reactive: typeof reactive;
  computed: typeof computed;
  watch: typeof watch;
  effectScope: typeof effectScope;
}

// ====== Scope 基础属性(所有 scope 都有的 $ 前缀属性 / 方法) ======
export interface PageScopeBase<
  S extends AnyRecord = AnyRecord,
  SO extends AnyRecord = AnyRecord,
> {
  readonly $id: string;
  readonly $state: S;
  readonly $source: SO;
  readonly $loading: Record<string, boolean>;
  readonly $status: {
    mounted: boolean;
    active: boolean;
  };
  readonly $disposed: boolean;

  $patch(partial: Partial<S> | ((state: S) => Partial<S>)): void;
  $reset(): void;

  $emit(event: string, payload?: any): void;
  $on(event: string, handler: (payload?: any) => void): () => void;
  $off(event: string, handler?: (payload?: any) => void): void;

  $setInterval(fn: () => void, delay: number): () => void;

  // ====== v0.2: 生命周期触发器(公共方法) ======
  // 库内部仍会在 onMounted / onActivated / onDeactivated / onBeforeUnmount 自动调用
  // 这些方法 —— Vue Router + keep-alive 场景行为与 v0.1 完全一致.
  //
  // 跨运行时 adapter(如 uni-app 小程序)可以在 onPageShow / onPageHide / onLoad /
  // onUnload 等宿主生命周期里显式调用这些方法,驱动 scope 进入对应状态.
  //
  // 状态机: created → inited → entered ⇄ left → destroyed
  // 幂等规则:
  // - $init: options.init 只执行一次,重复调用 dev warning 并忽略.
  // - $enter: destroyed 后无效; 已 entered 时忽略.
  // - $leave: 仅 entered 状态触发,其他状态忽略.
  // - $destroy: 只执行一次; 若当前 entered 会自动先 $leave 再释放 effectScope.
  /** 手动触发 options.init,只执行一次,重复调用 dev warning */
  $init(): void;
  /** 手动触发 options.enter,destroyed 后无效,已 enter 时 no-op */
  $enter(): void;
  /** 手动触发 options.leave,仅 entered 状态触发,其他状态 no-op */
  $leave(): void;

  /** 销毁 scope,只执行一次; 若当前 entered 自动先 $leave,再释放 effectScope */
  $destroy(): void;
}

// ====== 注入字段类型(只读) ======
type ReadonlyInjected<I> = {
  readonly [K in keyof I]: I[K];
};

// ====== 完整 Scope 类型(基础属性 + state + getters + actions + injected) ======
export type PageScope<
  S extends AnyRecord = AnyRecord,
  SO extends AnyRecord = AnyRecord,
  G extends AnyRecord = AnyRecord,
  A extends AnyRecord = AnyRecord,
  I extends AnyRecord = {}
> = PageScopeBase<S, SO> & S & GetterResults<G> & ActionMethods<A> & ReadonlyInjected<I>;

// ====== watch handler 类型 ======
export type PageScopeWatchHandler<TScope> =
  | ((this: TScope, value: any, oldValue: any) => void)
  | {
      handler: (this: TScope, value: any, oldValue: any) => void;
      deep?: boolean;
      immediate?: boolean;
    };

// ====== Plugin 协议 ======
export interface PageScopePlugin<
  TField = any,
  TScope = PageScope
> {
  name: string;
  install(
    scope: TScope,
    fieldValue: TField,
    ctx: PageScopeRuntimeContext
  ): void | {
    enter?: () => void;
    leave?: () => void;
    destroy?: () => void;
  };
}

// ====== 生命周期模式 (v0.2) ======
// 'auto' (默认): 库注册 Vue 组件生命周期 hook,自动驱动 init/enter/leave/destroy.
//                Vue Router + keep-alive 场景,行为与 v0.1 完全一致.
// 'manual':      库一律不注册任何 Vue 生命周期 hook,也不自动 init.
//                $init / $enter / $leave / $destroy 全部由 adapter 显式调用.
//                适用于 uni-app 小程序 / 微前端 / 自研路由等需要外部接管生命周期的场景.
// 模式名保持运行时无关,不绑定任何具体宿主语义.
export type ScopeLifecycleMode = 'auto' | 'manual';

// ====== definePageScope options ======
export interface DefinePageScopeOptions<
  S extends AnyRecord,
  SO extends AnyRecord,
  G extends AnyRecord,
  A extends AnyRecord,
  I extends AnyRecord = {},
  TScope = PageScope<S, SO, G, A, I>
> {
  /** 业务状态工厂函数(必填) */
  state(): S;

  /** 生命周期模式,默认 'auto'.见 ScopeLifecycleMode. */
  lifecycle?: ScopeLifecycleMode;

  /** 页面输入 / 原始返回工厂函数 */
  source?(): SO;

  /** 派生计算,this 指向 scope */
  getters?: G & ThisType<TScope>;

  /** 业务方法,this 指向 scope.返回 Promise 的方法自动追踪 $loading */
  actions?: A & ThisType<TScope>;

  /** 声明式 watcher,支持 dot-path */
  watch?: Record<string, PageScopeWatchHandler<TScope>>;

  /** Scope 创建后一次性调用,enter 之前.适合拉字典、注册事件监听 */
  init?(this: TScope): void;

  /** 页面进入可见 / 可交互状态时触发 */
  enter?(this: TScope): void;

  /** 页面离开可见 / 可交互状态时触发 */
  leave?(this: TScope): void;

  /** 注册过的 plugin 可声明自己的字段(field name === plugin.name) */
  [pluginField: string]: any;
}

// ====== 主 API ======

/**
 * 定义一个页面级 Scope
 *
 * 返回的 useXxxScope 函数必须在 Vue 3 组件的 setup() 内调用.
 *
 * @example
 *   const useOrderScope = definePageScope('order', {
 *     state: () => ({ keyword: '' }),
 *     actions: { search() {} },
 *     enter() { this.search() }
 *   })
 *
 *   // setup 内
 *   const orderScope = useOrderScope()
 */
export function definePageScope<
  S extends AnyRecord,
  SO extends AnyRecord = {},
  G extends AnyRecord = {},
  A extends AnyRecord = {},
  I extends AnyRecord = {}
>(
  id: string,
  options: DefinePageScopeOptions<S, SO, G, A, I>
): (injected?: I) => PageScope<S, SO, G, A, I>;

/**
 * 子组件中获取当前页面 Scope
 *
 * 用法:
 *   // Page.vue
 *   const orderScope = useOrderScope()
 *
 *   // Child.vue
 *   const orderScope = injectPageScope()
 */
export function injectPageScope<
  TScope extends PageScope = PageScope
>(): TScope | null;

/**
 * 注册全局 plugin
 *
 * plugin.name 同时作为 options 字段匹配键.
 * 当 definePageScope options 中存在 options[plugin.name] 时,
 * page-scope 会调用 plugin.install(scope, fieldValue, ctx).
 */
export function registerPlugin(plugin: PageScopePlugin): void;

/**
 * Scope 注册表 —— 导出供调试 / devtools 使用
 */
export const scopeRegistry: Map<string, PageScope>;

// ====== 默认导出 ======
declare const _default: {
  definePageScope: typeof definePageScope;
  injectPageScope: typeof injectPageScope;
  registerPlugin: typeof registerPlugin;
  scopeRegistry: typeof scopeRegistry;
};

export default _default;

// ====== 全局 dev-only 调试入口 ======
declare global {
  interface Window {
    __VUE_PAGE_SCOPE__?: {
      registry: Map<string, PageScope>;
      readonly scopes: Record<string, PageScope>;
    };
  }
}
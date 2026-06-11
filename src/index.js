/*!
 * vue-page-scope v0.1.0
 * (c) 2026 weijianjun
 * @license MIT
 */
/**
 * vue-page-scope 0.1.0 — Vue 3 Page Scope Runtime
 *
 * 页面级作用域运行时容器,基于 Vue 3 effectScope 实现。
 *
 * source · state · getters · actions · watch
 * init · enter · leave
 * $setInterval · event bus · plugin
 *
 * 这个包最初只是 vue-page-store 的 Vue 3 移植版 ——
 * 一个 Vue 2 时代的页面级状态管理库.
 * 但写到 v0.5 才意识到,这个库一直在做的事情并不是
 * "管理状态",而是在管理一个完整的页面作用域.
 * Vue 3 版本是这个意识到的事情第一次被正面命名.
 *
 * @author weijianjun
 * @license MIT
 */

import {
  reactive,
  computed,
  watch,
  effectScope,
  provide,
  inject,
  onMounted,
  onActivated,
  onDeactivated,
  onBeforeUnmount,
  getCurrentInstance,
  isRef,
} from 'vue';

import { createLifecycleController } from './lifecycle-controller.js';

// ====== dev-only warning ======
// 沿用 vue-page-store v0.5.1 的 try/catch 兜底,Vite / webpack 5 等不 polyfill process 的环境
var isDev = false;
try {
  isDev = typeof process !== 'undefined'
    && process.env
    && process.env.NODE_ENV !== 'production';
} catch (e) {
  // noop
}

function warn(msg) {
  if (isDev) {
    console.warn('[vue-page-scope] ' + msg);
  }
}

// ====== provide / inject key ======
var PAGE_SCOPE_KEY = 'pageScope';

// ====== Scope 注册表 ======
// 导出供调试 / devtools 使用(语义对齐 storeRegistry → scopeRegistry)
var scopeRegistry = new Map();

// dev 环境自动挂到 window,方便控制台调试
if (isDev && typeof window !== 'undefined') {
  window.__VUE_PAGE_SCOPE__ = {
    registry: scopeRegistry,
    get scopes() {
      var result = {};
      scopeRegistry.forEach(function (s, id) {
        result[id] = s;
      });
      return result;
    },
  };
}

// ====== plugin 机制 ======
var _plugins = [];

/**
 * 注册全局 plugin
 *
 * plugin.name 同时作为 options 字段匹配键:
 *   当 definePageScope options 中存在 options[plugin.name] 时,
 *   page-scope 会调用 plugin.install(scope, fieldValue, ctx)
 *
 * install 可返回 { enter, leave, destroy } 生命周期钩子
 *
 * 协议与 vue-page-store v0.5 完全一致.第三参数 ctx 在 Vue 3 版为
 * runtime context: { framework, version, reactive, computed, watch, effectScope }.
 * 同一份 plugin 主体(name + install + fieldValue + 返回 hooks)跨版本不变,
 * 仅 context 内容随框架版本不同.
 */
function registerPlugin(plugin) {
  if (!plugin || typeof plugin.name !== 'string') {
    throw new Error('[vue-page-scope] plugin 需要一个 name 属性');
  }
  if (typeof plugin.install !== 'function') {
    throw new Error(
      '[vue-page-scope] plugin "' + plugin.name + '" 需要一个 install 方法',
    );
  }
  if (_plugins.some(function (p) { return p.name === plugin.name; })) {
    warn('plugin "' + plugin.name + '" 已注册,跳过重复注册');
    return;
  }
  _plugins.push(plugin);
}

/**
 * 构造 plugin install 的第三参数 —— runtime context
 *
 * 设计原则:只转发 Vue 3 响应式核心 API,不引入新概念,不创造适配层.
 * plugin 通过 ctx 获取该版本下的响应式能力,而不需要硬编码 import.
 */
function createRuntimeContext() {
  return {
    framework: 'vue3',
    version: 3,
    reactive: reactive,
    computed: computed,
    watch: watch,
    effectScope: effectScope,
  };
}

/**
 * 自动桥接组件实例上的常用全局属性(目前是 $route / $router)
 *
 * 不 import vue-router —— 通过 instance.proxy 间接访问,
 * 如果用户项目装了 vue-router(把 $route / $router 挂到 app.config.globalProperties),
 * 就自动桥接;没装就 noop,不会多出 undefined 字段.
 *
 * 这不是恢复 Vue 2 时代的 `$vm` 逃生口 ——
 * 旧 $vm:把整个组件实例暴露给 scope,边界很脏.
 * auto bridge:只桥接 $route / $router 两个常用公共能力,不暴露完整组件实例.
 *
 * 桥接字段用 getter,而不是直接存值,保证 route 切换时 scope 内部读到的是最新的 route.
 * configurable: true —— 允许 explicit injection 覆盖.
 */
function installAutoBridge(scope, instance, id, _autoBridgeKeys) {
  var proxy = instance && instance.proxy;
  if (!proxy) return;

  function bridge(key) {
    if (key in scope) return;  // 不覆盖已有字段(state / getter / action)
    Object.defineProperty(scope, key, {
      enumerable: true,
      configurable: true,  // 允许被 explicit injection 覆盖
      get: function () { return proxy[key]; },
      set: function () {
        warn('scope "' + id + '" auto-bridge "' + key + '" 只读,不允许重写');
      },
    });
    _autoBridgeKeys.add(key);
  }

  if ('$route' in proxy) bridge('$route');
  if ('$router' in proxy) bridge('$router');
}

/**
 * 显式注入:用户传入 useXxxScope({ $xxx: composable }) 时,把字段挂到 scope 上.
 *
 * 规则:
 *   - 可以覆盖 auto bridge 字段(_autoBridgeKeys 里记录的)
 *   - 不能覆盖内置 $ 方法 / state / getter / action 等已有字段
 *   - 挂上后 configurable: false,不可再被覆盖
 *
 * 用 getter 而不是直接存值,保证传入的是 ref / reactive 时,scope 读到的是最新值.
 */
function installInjected(scope, injected, id, _autoBridgeKeys) {
  if (!injected || typeof injected !== 'object') return;

  Object.keys(injected).forEach(function (key) {
    var existed = key in scope;
    var isAutoBridge = _autoBridgeKeys.has(key);

    if (existed && !isAutoBridge) {
      warn(
        'scope "' + id + '" 注入字段 "' + key +
        '" 与已有字段冲突(内置 / state / getter / action),已跳过',
      );
      return;
    }

    if (isAutoBridge) {
      delete scope[key];
      _autoBridgeKeys.delete(key);
    }

    Object.defineProperty(scope, key, {
      enumerable: true,
      configurable: false,
      get: function () { return injected[key]; },
      set: function () {
        warn('scope "' + id + '" 注入字段 "' + key + '" 只读,不允许重写');
      },
    });
  });
}

// ====== createPageScopeInstance ======
// 用 effectScope(true) 包住所有响应式副作用,scope.stop() 一键释放
function createPageScopeInstance(id, options, instance, injected) {
  // 顶层 detached scope —— 不让 scope 被组件 setup scope 收编
  var effectScopeRef = effectScope(true);

  // plugin hooks 闭包存储
  var _pluginHooks = [];

  // 记录 auto bridge 字段名,使 installInjected 知道哪些字段可被覆盖
  var _autoBridgeKeys = new Set();

  // 提前声明 scope,供 getters / watch / plugin 闭包引用
  var scope = { $disposed: false };

  // ====== 第一阶段:基础能力建立(响应式数据 + getters + actions + watch) ======
  // 全部放进 effectScopeRef.run,保证所有 watch / computed 被 scope 收纳
  effectScopeRef.run(function () {
    var initialState = options.state();
    var initialSource =
      typeof options.source === 'function' ? options.source() : {};
    var getters = options.getters || {};

    // ====== 响应式数据 ======
    var $state = reactive(initialState);
    var $source = reactive(initialSource);
    var $loading = reactive({});
    var $status = reactive({ mounted: false, active: false });

    // ====== state —— 顶层代理到 $state ======
    // 只代理 initialState 声明的 key.动态字段通过 $patch / $state 访问,
    // 不会成为 scope.xxx 顶层访问点(与 v0.5 语义对齐)
    Object.keys(initialState).forEach(function (key) {
      Object.defineProperty(scope, key, {
        enumerable: true,
        configurable: true,
        get: function () { return $state[key]; },
        set: function (val) {
          if (scope.$disposed) {
            warn('scope "' + id + '" 已销毁,忽略对 "' + key + '" 的写入');
            return;
          }
          $state[key] = val;
        },
      });
    });

    // ====== $source / $loading / $status / $state / $id —— 直接挂载 ======
    // Proxy 自动处理动态字段,不再需要 Vue.set
    scope.$source = $source;
    scope.$loading = $loading;
    scope.$status = $status;
    scope.$state = $state;
    scope.$id = id;

    // ====== getters —— computed 代理 ======
    Object.keys(getters).forEach(function (key) {
      var c = computed(function () {
        return getters[key].call(scope);
      });
      Object.defineProperty(scope, key, {
        enumerable: true,
        configurable: true,
        // 用户访问 scope.total,不是 scope.total.value
        // Options-style 语义外壳必须维持
        get: function () { return c.value; },
      });
    });

    // ====== actions —— async 自动追踪 $loading ======
    var actions = options.actions || {};
    var _loadingCounts = {};

    function finishLoading(key) {
      // 销毁后短路:避免向已 stop 的 $loading 写入,与 README 的异步安全承诺对齐
      if (scope.$disposed) return;
      _loadingCounts[key]--;
      if (_loadingCounts[key] <= 0) {
        _loadingCounts[key] = 0;
        $loading[key] = false;
      }
    }

    Object.keys(actions).forEach(function (key) {
      var originalFn = actions[key];
      var boundFn = originalFn.bind(scope);

      scope[key] = function () {
        var result = boundFn.apply(null, arguments);
        if (result && typeof result.then === 'function') {
          if (!_loadingCounts[key]) _loadingCounts[key] = 0;
          _loadingCounts[key]++;
          $loading[key] = true;
          Promise.resolve(result).then(
            function () { finishLoading(key); },
            function () { finishLoading(key); },
          );
        }
        return result;
      };
    });

    // ====== $patch ======
    scope.$patch = function (partial) {
      if (scope.$disposed) {
        warn('scope "' + id + '" 已销毁,忽略 $patch 操作');
        return;
      }
      var obj = typeof partial === 'function' ? partial($state) : partial;
      Object.keys(obj).forEach(function (key) {
        $state[key] = obj[key];
      });
    };

    // ====== $reset ======
    // 原地改 key,不替换整个 reactive 对象 —— 否则闭包引用全断
    // 顺序对齐 vue-page-store v0.5.3:先恢复 fresh key,再删除 stale key
    scope.$reset = function () {
      var freshState = options.state();
      Object.keys(freshState).forEach(function (key) {
        $state[key] = freshState[key];
      });
      Object.keys($state).forEach(function (key) {
        if (!(key in freshState)) delete $state[key];
      });

      var freshSource =
        typeof options.source === 'function' ? options.source() : {};
      Object.keys(freshSource).forEach(function (key) {
        $source[key] = freshSource[key];
      });
      Object.keys($source).forEach(function (key) {
        if (!(key in freshSource)) delete $source[key];
      });
    };

    // ====== auto bridge —— 自动桥接组件实例的 $route / $router ======
    // 时机:public API(state proxy / $内置字段 / getters / actions / $patch / $reset)全部就绪之后,
    //       watch / plugin / init 之前.
    // 这样既能保证 injection 检测得到所有已挂字段(防止用户 inject 撞名 action / getter / $patch 等),
    // 又能让 watch 监听 `$route.query.xxx` 时拿到 $route.
    installAutoBridge(scope, instance, id, _autoBridgeKeys);

    // ====== explicit injection —— 用户通过 useXxxScope({ ... }) 注入 ======
    // 优先级高于 auto bridge:用户传入的 $route 会覆盖 auto bridge 的 $route.
    installInjected(scope, injected, id, _autoBridgeKeys);

    // ====== watch —— 声明式副作用 ======
    // watch 注册在 effectScope.run 里,scope.stop() 自动停止所有 watcher
    var watches = options.watch || {};
    Object.keys(watches).forEach(function (path) {
      var def = watches[path];
      var handler, watchOpts;

      if (typeof def === 'function') {
        handler = def;
        watchOpts = {};
      } else {
        handler = def.handler;
        watchOpts = {};
        if (def.deep) watchOpts.deep = true;
        if (def.immediate) watchOpts.immediate = true;
        if (!handler) {
          warn(
            'watch "' + path + '" in scope "' + id +
            '" 缺少 handler,该 watcher 将被跳过',
          );
          return;
        }
      }

      // dot-path 解析(沿用 vue-page-store v0.5.3 逻辑)
      var getter = function () {
        return path.split('.').reduce(function (obj, k) {
          return obj && obj[k];
        }, scope);
      };
      // handler bind(scope),保持 this 语义和 Vue 2 版一致
      watch(getter, handler.bind(scope), watchOpts);
    });
  }); // end of 第一阶段 effectScopeRef.run

  // ====== 事件总线 —— 沿用 vue-page-store v0.5.3 内置实现 ======
  var _listeners = {};

  scope.$emit = function (event, payload) {
    var fns = _listeners[event];
    if (fns) fns.slice().forEach(function (fn) { fn(payload); });
  };

  scope.$on = function (event, handler) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(handler);
    return function () {
      if (!_listeners[event]) return;
      var idx = _listeners[event].indexOf(handler);
      if (idx > -1) _listeners[event].splice(idx, 1);
    };
  };

  scope.$off = function (event, handler) {
    if (!_listeners[event]) return;
    if (handler) {
      var idx = _listeners[event].indexOf(handler);
      if (idx > -1) _listeners[event].splice(idx, 1);
    } else {
      delete _listeners[event];
    }
  };

  // ====== $setInterval —— 页面级 timer 托管 ======
  var _intervals = [];

  scope.$setInterval = function (fn, delay) {
    var timerId = setInterval(fn, delay);
    var entry = { id: timerId, stopped: false };
    _intervals.push(entry);
    return function stop() {
      if (entry.stopped) return;
      clearInterval(entry.id);
      entry.stopped = true;
      var idx = _intervals.indexOf(entry);
      if (idx > -1) _intervals.splice(idx, 1);
    };
  };

  function clearAllIntervals() {
    _intervals.forEach(function (entry) {
      if (!entry.stopped) {
        clearInterval(entry.id);
        entry.stopped = true;
      }
    });
    _intervals.length = 0;
  }

  // ====== enter / leave / init 控制 ======
  // v0.2 起,生命周期触发器由 createLifecycleController 统一管理,并通过
  // scope.$init / scope.$enter / scope.$leave 暴露为公共方法.
  //
  // v0.1 行为保留: 库内部仍在 onMounted / onActivated / onDeactivated /
  // onBeforeUnmount 自动调用这些方法,Vue Router + keep-alive 场景用法不变.
  //
  // 新增能力: 跨运行时 adapter(如 uni-app 小程序 onPageShow/onPageHide)可以
  // 直接调用 scope.$enter() / scope.$leave() 显式驱动生命周期.
  //
  // init 包进 effectScopeRef.run —— 用户即使在 init 里手写 watch,
  // 这些 watch 也会被 scope.stop() 自动回收.
  // 但 README 仍应明确:init 只用于一次性初始化(拉字典、注册事件监听等),
  // 响应式副作用请用声明式的 watch option.
  var controller = createLifecycleController({
    scope: scope,
    options: options,
    effectScopeRef: effectScopeRef,
    pluginHooks: _pluginHooks,
    clearAllIntervals: clearAllIntervals,
    warn: warn,
    id: id,
  });

  scope.$init = controller.runInit;
  scope.$enter = controller.runEnter;
  scope.$leave = controller.runLeave;

  // ====== $getContext —— context 通道 (v0.2) ======
  // 解析 options.context 的三种形态为 C:
  //   () => T  -> 调用取值     (函数一律视为 getter)
  //   Ref<T>   -> 解包 .value
  //   T        -> 原样返回     (reactive(T) 走此分支,本就是 T 形状)
  // 惰性 resolve,每次调用都重新读取,不缓存 —— Ref / getter 始终反映最新值.
  // 时机:此处早于 useScope 驱动的 $init() 与任何 onMounted/$enter,init/enter/leave 内可调.
  function resolveContext(src) {
    if (typeof src === 'function') return src();
    if (isRef(src)) return src.value;
    return src;
  }

  scope.$getContext = function () {
    // destroyed 后返回 undefined(诚实的"无上下文"信号,避免销毁后异步回调误用 stale).
    if (scope.$disposed) {
      warn('scope "' + id + '" 已销毁,$getContext() 返回 undefined');
      return undefined;
    }
    if (options.context === undefined) return undefined;
    // 不 try/catch:getter 抛错说明上下文从根上有问题,让错误正常上抛,
    // 不把真 bug 推迟到下游空指针.也不主动 untrack —— 响应式上下文内调用
    // 收集依赖是用户的合理预期(context 变了应重触发 watch).
    return resolveContext(options.context);
  };

  // ====== $destroy ======
  // 幂等:只执行一次(再次调用直接返回).
  // 若当前 entered,自动先 $leave —— 触发 leave hook / page:leave / plugin leave,
  // 保证 entered → destroyed 不会跳过 leave 语义.之后再 stop effectScope.
  scope.$destroy = function () {
    if (scope.$disposed) return;
    if (controller.isEntered()) {
      controller.runLeave();
    }
    scope.$status.mounted = false;
    scope.$status.active = false;
    clearAllIntervals();
    _pluginHooks.forEach(function (h) { if (h.destroy) h.destroy(); });
    scope.$disposed = true;
    Object.keys(_listeners).forEach(function (key) {
      delete _listeners[key];
    });
    // effectScope.stop() 一键释放所有 watch / computed
    // (包括 plugin 内创建的 —— 因为 plugin install 也在 effectScope 内)
    effectScopeRef.stop();
    // self-evict: 销毁链尾部(leave → stop → disposed → evict)从 registry 摘除自己.
    // cached === scope 守卫不能省 —— 只删自己这个实例,防止删掉已被新实例顶替的
    // 同 id 条目(否则 destroy 旧 scope 会误删 registry 里的新 scope).
    var cached = scopeRegistry.get(id);
    if (cached === scope) scopeRegistry.delete(id);
  };

  // ====== 第二阶段:plugin 安装 ======
  // 严格对齐 v0.5 时序:state / source / getters / actions / watch 全部就绪后,
  // 在 scope 末尾安装 plugin.顺序一行不改.
  //
  // Vue 3 特有的硬约束:plugin install 必须运行在 effectScopeRef 内 ——
  // plugin 里创建的 watch / computed / watchEffect 才能被 scope.stop() 回收.
  // 否则页面作用域停了,但 plugin 副作用还可能在外面飘.
  effectScopeRef.run(function () {
    _plugins.forEach(function (plugin) {
      var fieldValue = options[plugin.name];
      if (fieldValue === undefined) return;
      var hooks = plugin.install(scope, fieldValue, createRuntimeContext());
      if (hooks) _pluginHooks.push(hooks);
    });
  });

  // 返回 scope.
  // v0.1 中三个生命周期触发器是闭包私有的; v0.2 起统一通过 scope.$init /
  // scope.$enter / scope.$leave 暴露为公共方法, 不再需要从 createPageScopeInstance
  // 单独返回. 库内部 useScope() 直接调用 scope.$xxx, 行为与 v0.1 一致.
  return { scope: scope };
}

// ====== definePageScope ======
/**
 * 定义页面级 Scope
 *
 * 返回一个 useXxxScope 函数,必须在 Vue 3 组件的 setup() 内调用.
 *
 * Owner 模型:
 *   - useXxxScope() 应该只在页面级组件调用 ——
 *     该组件成为 scope 的 owner,负责 provide 和生命周期.
 *   - 子组件通过 injectPageScope() 获取 scope,不要重复 useXxxScope().
 *   - 同一个 scope id 在同一时刻只能有一个 owner.
 */
function definePageScope(id, options) {
  if (!id || typeof id !== 'string') {
    throw new Error(
      '[vue-page-scope] definePageScope 需要一个非空字符串作为 id',
    );
  }
  if (!options || typeof options.state !== 'function') {
    throw new Error(
      '[vue-page-scope] definePageScope("' + id + '") 需要 state 为函数',
    );
  }

  return function useScope(injected) {
    // 必须在 setup 内调用 —— Vue 3 版的硬约束
    var instance = getCurrentInstance();
    if (!instance) {
      throw new Error(
        '[vue-page-scope] useXxxScope() 必须在 setup() 内调用',
      );
    }

    var scope;
    var isFirstBinding = false;

    var cachedScope = scopeRegistry.has(id) ? scopeRegistry.get(id) : null;
    // 命中缓存但已销毁:摘除旧条目,走重建分支拿全新 scope.
    // (registry 缓存 + $destroy 摘除存在时序窗口 —— 若 cached 已 disposed,
    // 复用它只会得到一个被冻结的死 scope,故视同未命中.)
    if (cachedScope && cachedScope.$disposed) {
      scopeRegistry.delete(id);
      cachedScope = null;
    }

    if (cachedScope) {
      scope = cachedScope;
      // 非首次绑定时如果还传了 injected,提示用户:注入只在 owner 处生效
      if (injected && Object.keys(injected).length > 0) {
        warn(
          'scope "' + id + '" 已存在,本次 useXxxScope(injected) 的 injected 被忽略.' +
          '注入只在 owner(首次调用 useXxxScope 的组件)处生效.',
        );
      }
    } else {
      // instance + injected 传给 createPageScopeInstance ——
      // auto bridge 和 explicit injection 必须在 scope 内部完成,
      // 时序上要早于 getters / actions / watch / plugin install / init.
      var created = createPageScopeInstance(id, options, instance, injected);
      scope = created.scope;
      scopeRegistry.set(id, scope);
      isFirstBinding = true;
    }

    // ====== 生命周期绑定 —— 单 owner 模型 ======
    // 仅首次绑定的组件挂生命周期钩子.
    // 子组件如果误调 useXxxScope(),会收到 warning,且不会触发重复 enter/leave.
    if (isFirstBinding) {
      // ====== 生命周期模式 (v0.2): 'auto' (默认) | 'manual' ======
      // 一个开关控制所有"自动行为",保持清晰边界(不在每个 hook 内单独判断):
      //   auto   —— 自动调用 $init,并注册 onMounted/onActivated/onDeactivated/
      //             onBeforeUnmount 自动驱动 $enter/$leave/$destroy. 行为与 v0.1 完全一致.
      //   manual —— 库一律不注册任何 Vue 生命周期 hook,也不自动 $init.
      //             scope 创建即可用(plugin 已就绪),但 $init/$enter/$leave/$destroy
      //             全部等 adapter 显式调用.即使开发者混用,Vue hook 也不会偷偷触发.
      // 注意:provide 不在开关内 —— 子组件 injectPageScope() 在两种模式下都要能用.
      if (options.lifecycle !== 'manual') {
        // init 钩子 —— 只在 scope 首次创建时调用,与 vue-page-store v0.5 语义一致.
        // 已包进 effectScopeRef.run,init 里手写的 watch 也会被 scope.stop() 回收.
        // 防御:init 抛错时自毁 scope,避免 registry 里残留半初始化的 scope.
        try {
          scope.$init();
        } catch (err) {
          scope.$destroy();
          throw err;
        }

        // onMounted + onActivated 双挂,用 _entered 状态机去重
        // 处理 keep-alive 首次激活时 onMounted 和 onActivated 双响炮的情况
        onMounted(function () { scope.$enter(); });
        onActivated(function () { scope.$enter(); });
        onDeactivated(function () { scope.$leave(); });

        onBeforeUnmount(function () {
          scope.$leave();
          scope.$destroy();
        });
      }

      provide(PAGE_SCOPE_KEY, scope);
    } else {
      warn(
        'scope "' + id + '" 已存在.useXxxScope() 建议只在页面级组件调用,' +
        '子组件请使用 injectPageScope().',
      );
    }

    return scope;
  };
}

/**
 * 子组件中获取当前页面 scope
 *
 * 用法:
 *   // Page.vue
 *   const orderScope = useOrderScope()
 *
 *   // Child.vue
 *   const orderScope = injectPageScope()
 */
function injectPageScope() {
  var scope = inject(PAGE_SCOPE_KEY, null);
  if (!scope) {
    warn(
      'injectPageScope() 未找到 pageScope,' +
      '请确认父级页面组件已调用 useXxxScope().',
    );
  }
  return scope;
}

// ====== exports ======
var index = {
  definePageScope: definePageScope,
  injectPageScope: injectPageScope,
  registerPlugin: registerPlugin,
  scopeRegistry: scopeRegistry,
};

export {
  index as default,
  definePageScope,
  injectPageScope,
  registerPlugin,
  scopeRegistry,
};
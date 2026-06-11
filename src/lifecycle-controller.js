/**
 * Lifecycle controller —— v0.2 引入
 *
 * 把 init / enter / leave 三个生命周期触发器从 createPageScopeInstance 内联实现
 * 中抽出, 同时通过 scope.$init / scope.$enter / scope.$leave 暴露为公共方法.
 *
 * 设计动机:
 *   v0.1 假设宿主是 Vue Router + keep-alive 场景, 通过 onMounted / onActivated /
 *   onDeactivated / onBeforeUnmount 四个组件生命周期自动驱动 enter / leave / destroy.
 *   这套假设在 uni-app 小程序端不成立 —— 小程序 onPageShow / onPageHide 不会触发
 *   Vue 的 onActivated / onDeactivated. adapter 需要能显式控制 enter / leave 时机.
 *
 *   把触发器从闭包暴露到 scope.$method, 是最小代价的扩展. v0.1 的 Vue Router 用法
 *   仍由库内部自动绑定调用 scope.$enter, 行为 100% 不变.
 *
 * 状态机 (v0.2 Step 3 形式化):
 *
 *     created → inited → entered ⇄ left → destroyed
 *
 *   用 _initialized / _entered 两个布尔标志 + scope.$disposed 编码:
 *     created  : !_initialized && !_entered && !$disposed
 *     inited   :  _initialized && !_entered && !$disposed
 *     entered  :  _entered                  && !$disposed
 *     left     :  _initialized && !_entered && !$disposed (entered 之后再 leave)
 *     destroyed:  $disposed
 *   注: inited 与 left 行为等价(都是"非 entered、非 destroyed、可再 enter"),
 *       因此无需第三个标志区分.
 *
 * 幂等规则:
 *   - $init  : 只执行一次. 重复调用 dev warning 并忽略. destroyed 后调用同样忽略.
 *   - $enter : destroyed 后无效(忽略); 已 entered 时忽略; 其余状态 → entered.
 *   - $leave : 仅 entered 状态触发; 其他状态忽略.
 *   - $destroy: 见 index.js —— 只执行一次; 若当前 entered 自动先 $leave 再 stop effectScope.
 *
 * 与 effectScope 的关系:
 *   - init hook 仍然包进 effectScopeRef.run, init 里手写的 watch 仍由 scope.stop() 回收.
 *   - enter / leave hook 不再额外包 effectScope.run, 与 v0.1 一致.
 */

export function createLifecycleController(deps) {
  var scope = deps.scope;
  var options = deps.options;
  var effectScopeRef = deps.effectScopeRef;
  var pluginHooks = deps.pluginHooks;
  var clearAllIntervals = deps.clearAllIntervals;
  var warn = deps.warn;
  var id = deps.id;

  var initHook = typeof options.init === 'function' ? options.init : null;
  var enterHook = typeof options.enter === 'function' ? options.enter : null;
  var leaveHook = typeof options.leave === 'function' ? options.leave : null;

  var _initialized = false;
  var _entered = false;

  function runInit() {
    if (scope.$disposed) {
      warn('scope "' + id + '" 已销毁,$init 调用被忽略');
      return;
    }
    if (_initialized) {
      warn('scope "' + id + '" $init 只能调用一次,本次重复调用被忽略');
      return;
    }
    _initialized = true;
    if (!initHook) return;
    effectScopeRef.run(function () {
      initHook.call(scope);
    });
  }

  function runEnter() {
    // destroyed 后无效; 已 entered 时忽略.
    if (scope.$disposed || _entered) return;
    _entered = true;
    scope.$status.mounted = true;
    scope.$status.active = true;
    if (enterHook) enterHook.call(scope);
    scope.$emit('page:enter');
    pluginHooks.forEach(function (h) {
      if (h.enter) h.enter();
    });
  }

  function runLeave() {
    // 仅 entered 状态触发; 其他状态(created / inited / left / destroyed)忽略.
    if (!_entered) return;
    clearAllIntervals();
    _entered = false;
    scope.$status.active = false;
    if (leaveHook) leaveHook.call(scope);
    scope.$emit('page:leave');
    pluginHooks.forEach(function (h) {
      if (h.leave) h.leave();
    });
  }

  return {
    runInit: runInit,
    runEnter: runEnter,
    runLeave: runLeave,
    // 供 $destroy 判断"当前是否 entered",以决定是否自动先 $leave.
    isEntered: function () { return _entered; },
  };
}

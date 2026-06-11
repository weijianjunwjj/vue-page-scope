// Web (Vue Router / auto 模式) 回归套件。
//
// 背景：v0.2 为 uni-app 适配引入了 lifecycle controller / lifecycle:'auto'|'manual'
// 开关 / context 通道 / registry disposed-reuse 修复。小程序(manual)路径已由
// spike 工程的 __verify__ + 真机 A–I 覆盖；本套件专门钉死 **web(auto)路径行为不变**，
// 尤其是 registry 这处 auto/manual 共享改动，确保合并 main 不影响 web 端。
//
// 直接测 src/index.js（源码真值），不测 dist。

import { describe, it, expect, afterEach, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { definePageScope, injectPageScope, scopeRegistry } from '../src/index.js'

// 每个用例用唯一 id，afterEach 清 registry 兜底（防跨用例污染）。
afterEach(() => {
  scopeRegistry.clear()
})

// 造一个标准 scope 定义（auto 模式：不传 lifecycle）。spies 计数生命周期钩子。
function makeScopeDef(id, spies = {}) {
  const noop = () => {}
  return definePageScope(id, {
    source: () => ({ tag: 'pending' }),
    state: () => ({ count: 0 }),
    getters: {
      double() {
        return this.count * 2
      },
    },
    actions: {
      inc() {
        this.count++
      },
      async loadAsync(ok = true) {
        await Promise.resolve()
        if (!ok) throw new Error('boom')
        this.count += 10
        return 'done'
      },
    },
    init() {
      ;(spies.init || noop)()
      this.$source.tag = 'inited'
    },
    enter() {
      ;(spies.enter || noop)()
    },
    leave() {
      ;(spies.leave || noop)()
    },
  })
}

function mountWithScope(useS, onScope) {
  const Comp = defineComponent({
    setup() {
      const s = useS()
      onScope(s)
      return () => h('div', String(s.count))
    },
  })
  return mount(Comp)
}

describe('web auto-mode lifecycle', () => {
  it('init + enter 在挂载时各跑一次；leave + destroy 在卸载时跑', () => {
    const spies = { init: vi.fn(), enter: vi.fn(), leave: vi.fn() }
    const useS = makeScopeDef('t1', spies)
    let s
    const w = mountWithScope(useS, (x) => (s = x))

    expect(spies.init).toHaveBeenCalledTimes(1)
    expect(spies.enter).toHaveBeenCalledTimes(1)
    expect(spies.leave).toHaveBeenCalledTimes(0)
    expect(s.$disposed).toBe(false)
    expect(s.$status.active).toBe(true)
    expect(s.$source.tag).toBe('inited')

    w.unmount()
    expect(spies.leave).toHaveBeenCalledTimes(1) // 仅一次：onBeforeUnmount leave，$destroy 不重复 leave
    expect(s.$disposed).toBe(true)
    expect(s.$status.active).toBe(false)
  })

  it('state / getters / actions 响应式正常', async () => {
    const useS = makeScopeDef('t2')
    let s
    const w = mountWithScope(useS, (x) => (s = x))

    expect(s.count).toBe(0)
    expect(s.double).toBe(0)
    s.inc()
    await nextTick()
    expect(s.count).toBe(1)
    expect(s.double).toBe(2)
    expect(w.text()).toBe('1')
    w.unmount()
  })

  it('$loading 自动追踪异步 action（resolve + reject 双路径归位）', async () => {
    const useS = makeScopeDef('t3')
    let s
    mountWithScope(useS, (x) => (s = x))

    const p = s.loadAsync(true)
    expect(s.$loading.loadAsync).toBe(true)
    await p
    expect(s.$loading.loadAsync).toBe(false)
    expect(s.count).toBe(10)

    await expect(s.loadAsync(false)).rejects.toThrow('boom')
    expect(s.$loading.loadAsync).toBe(false) // reject 也归位
  })
})

describe('web keep-alive', () => {
  it('onActivated→enter / onDeactivated→leave；state 保留；init 不重跑；真卸载才 destroy', async () => {
    const spies = { init: vi.fn(), enter: vi.fn(), leave: vi.fn() }
    const useS = makeScopeDef('t4', spies)
    let s
    const Inner = defineComponent({
      setup() {
        s = useS()
        return () => h('div')
      },
    })
    const Wrapper = defineComponent({
      props: { show: { type: Boolean, default: true } },
      setup(props) {
        return () => h(KeepAlive, null, [props.show ? h(Inner) : null])
      },
    })
    const w = mount(Wrapper, { props: { show: true } })

    expect(spies.init).toHaveBeenCalledTimes(1)
    expect(spies.enter).toHaveBeenCalledTimes(1)
    s.inc()
    await nextTick()
    expect(s.count).toBe(1)

    await w.setProps({ show: false }) // deactivate
    expect(spies.leave).toHaveBeenCalledTimes(1)
    expect(s.$disposed).toBe(false) // keep-alive 缓存，未销毁

    await w.setProps({ show: true }) // reactivate
    expect(spies.enter).toHaveBeenCalledTimes(2)
    expect(spies.init).toHaveBeenCalledTimes(1) // init 不重跑
    expect(s.count).toBe(1) // state 保留

    w.unmount() // 真卸载
    expect(s.$disposed).toBe(true)
  })
})

describe('web owner / DI', () => {
  it('子组件 injectPageScope() 拿到同一 scope 实例', () => {
    const useS = makeScopeDef('t5')
    let owner, child
    const Child = defineComponent({
      setup() {
        child = injectPageScope()
        return () => h('span')
      },
    })
    const Owner = defineComponent({
      setup() {
        owner = useS()
        return () => h(Child)
      },
    })
    mount(Owner)
    expect(child).toBe(owner)
  })

  it('第二次 useXxxScope() 复用实例 + 不重跑 init + dev warning', () => {
    const spies = { init: vi.fn() }
    const useS = makeScopeDef('t6', spies)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let a, b
    const Child = defineComponent({
      setup() {
        b = useS() // 误用：子组件里又调 useXxxScope
        return () => h('span')
      },
    })
    const Owner = defineComponent({
      setup() {
        a = useS()
        return () => h(Child)
      },
    })
    mount(Owner)

    expect(b).toBe(a)
    expect(spies.init).toHaveBeenCalledTimes(1) // 不重跑 init
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('web registry disposed-reuse 修复（auto/manual 共享路径，合并 main 重点）', () => {
  it('卸载后同 id 重新挂载得到全新 scope（不复用 disposed 的）+ init 重跑', () => {
    const spies = { init: vi.fn() }
    const useS = makeScopeDef('t7', spies)
    const seen = []
    const Comp = defineComponent({
      setup() {
        seen.push(useS())
        return () => h('div')
      },
    })

    const w1 = mount(Comp)
    const first = seen[0]
    expect(spies.init).toHaveBeenCalledTimes(1)
    expect(first.$disposed).toBe(false)

    w1.unmount()
    expect(first.$disposed).toBe(true)
    // self-evict：销毁后 registry 不再持有它
    expect(scopeRegistry.get('t7')).toBeUndefined()

    const w2 = mount(Comp)
    const second = seen[1]
    expect(second).not.toBe(first) // 全新实例，不是冻结的死 scope
    expect(second.$disposed).toBe(false)
    expect(spies.init).toHaveBeenCalledTimes(2) // init 重跑
    w2.unmount()
  })

  it('A→B→A 连续重挂载，每次都是干净的新 scope', () => {
    const useS = makeScopeDef('t8')
    const seen = []
    const Comp = defineComponent({
      setup() {
        seen.push(useS())
        return () => h('div')
      },
    })
    for (let i = 0; i < 3; i++) {
      const w = mount(Comp)
      expect(seen[i].$disposed).toBe(false)
      w.unmount()
      expect(seen[i].$disposed).toBe(true)
    }
    // 三个互不相同
    expect(new Set(seen).size).toBe(3)
    expect(scopeRegistry.get('t8')).toBeUndefined()
  })
})

describe('web context 通道（auto 模式也可用）', () => {
  it('$getContext() 惰性解析 getter，init 内读到最新值', () => {
    const q = ref({ foo: 'bar' })
    const useS = definePageScope('t9', {
      context: () => q.value,
      source: () => ({ foo: '' }),
      state: () => ({}),
      init() {
        this.$source.foo = (this.$getContext() || {}).foo
      },
    })
    let s
    const Comp = defineComponent({
      setup() {
        s = useS()
        return () => h('div')
      },
    })
    mount(Comp)
    expect(s.$source.foo).toBe('bar')
    expect(s.$getContext()).toEqual({ foo: 'bar' })
  })
})

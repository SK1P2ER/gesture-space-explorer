/**
 * Experimental engine-only disposal subscriptions for one WebGL context epoch.
 * The enumerable registry must never retain either resource owners or callbacks:
 * callbacks such as the morph/depth listeners can themselves capture the owner.
 * A live owner retains its wrapper through EventDispatcher, as before.
 */
export function createDisposalScope(epoch = 0) {
  let active = true;
  let owners = new WeakMap();
  const entries = new Set();
  let registrations = 0;
  let removals = 0;
  const collected = new FinalizationRegistry((entry) => entries.delete(entry));

  function forget(entry) {
    entries.delete(entry);
    collected.unregister(entry);
  }

  function subscribe(owner, listener) {
    if (!active) return;
    let listeners = owners.get(owner);
    if (listeners === undefined) {
      listeners = new WeakMap();
      owners.set(owner, listeners);
    }
    if (listeners.has(listener)) return;

    // Do not capture owner here. Preserve EventDispatcher's this/arguments and
    // exception behavior; the entry-point guard prevents nested public dispose.
    const wrapped = function (...args) {
      if (active) return listener.apply(this, args);
    };
    const entry = {
      owner: new WeakRef(owner),
      listener: new WeakRef(listener),
      wrapped: new WeakRef(wrapped),
    };
    owner.addEventListener('dispose', wrapped);
    listeners.set(listener, entry);
    entries.add(entry);
    collected.register(owner, entry, entry);
    registrations++;
  }

  function unsubscribe(owner, listener) {
    const listeners = owners.get(owner);
    const entry = listeners?.get(listener);
    if (entry === undefined) return;
    const wrapped = entry.wrapped.deref();
    if (wrapped !== undefined) owner.removeEventListener('dispose', wrapped);
    listeners.delete(listener);
    forget(entry);
    removals++;
  }

  function has(owner, listener) {
    return active && owners.get(owner)?.has(listener) === true;
  }

  function abandon() {
    if (!active) return 0;
    // Invalidate first: even a wrapper already copied into a dispatch snapshot
    // cannot enter an obsolete manager while subscriptions are being detached.
    active = false;
    const count = entries.size;
    for (const entry of entries) {
      const owner = entry.owner.deref();
      const wrapped = entry.wrapped.deref();
      if (owner !== undefined && wrapped !== undefined) {
        owner.removeEventListener('dispose', wrapped);
      }
      collected.unregister(entry);
    }
    entries.clear();
    owners = new WeakMap();
    return count;
  }

  return {
    subscribe,
    unsubscribe,
    has,
    abandon,
    get active() { return active; },
    stats: () => ({ epoch, active, subscriptions: entries.size, registrations, removals }),
  };
}

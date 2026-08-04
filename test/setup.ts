class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub

if (!document.elementFromPoint) {
  document.elementFromPoint = () => null
}

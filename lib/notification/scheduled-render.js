export function createScheduledImageRenderer({ RuntimeClass, renderImg }) {
  if (typeof RuntimeClass !== "function") {
    throw new TypeError("RuntimeClass must be a constructor")
  }
  if (typeof renderImg !== "function") {
    throw new TypeError("renderImg must be a function")
  }

  const event = {}
  event.runtime = new RuntimeClass(event)
  const renderContext = { e: event }
  return (...args) => renderImg.call(renderContext, ...args)
}

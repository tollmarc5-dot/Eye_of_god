import { runForceLayout, type LayoutRequest, type LayoutResponse } from './force-layout'

// Layout always runs off the main thread: one request in, one response out,
// then the caller terminates the worker. Nothing here runs continuously.
addEventListener('message', (event: MessageEvent<LayoutRequest>) => {
  const positions = runForceLayout(event.data)
  const response: LayoutResponse = { positions }
  postMessage(response, { transfer: [positions.buffer] })
})

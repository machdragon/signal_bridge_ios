import Foundation
import UIKit

@objc(VoIPKeepAlive)
class VoIPKeepAlive: RCTEventEmitter {

  private var hasListeners = false

  override static func requiresMainQueueSetup() -> Bool { true }

  override func supportedEvents() -> [String]! {
    return ["onKeepAlive"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  @objc func register() {
    DispatchQueue.main.async {
      // Called by iOS every 600s while app is backgrounded with voip mode.
      // The handler must complete within a few seconds — we just emit to JS
      // so the relay can send a ping and keep the socket marked as active.
      UIApplication.shared.setKeepAliveTimeout(600) { [weak self] in
        guard let self = self, self.hasListeners else { return }
        self.sendEvent(withName: "onKeepAlive", body: nil)
      }
    }
  }

  @objc func unregister() {
    DispatchQueue.main.async {
      UIApplication.shared.clearKeepAliveTimeout()
    }
  }
}

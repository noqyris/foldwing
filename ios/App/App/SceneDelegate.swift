import UIKit
import Capacitor

/**
 * The one window of the app, under the UIScene life cycle.
 *
 * WHY IT EXISTS. An app built with the iOS 27 SDK must adopt UIScene or UIKit
 * refuses to launch it: a second of black screen, then back to the home screen,
 * with "UIScene life cycle is required for apps built with this SDK" in the
 * log. TestFlight 1.4 (52) was archived with Xcode 27 and did exactly that on
 * iOS 27. Info.plist's UIApplicationSceneManifest names this class; the
 * AppDelegate's configurationForConnecting names it again.
 *
 * THE WINDOW COMES FROM THE STORYBOARD. The scene configuration names
 * Main.storyboard (UISceneStoryboardFile). UIKit builds the window, creates the
 * storyboard's initial controller, FoldwingBridgeViewController, sets it as the
 * root and puts the window in `window` before `willConnectTo` runs, then shows
 * the window itself. Nothing here creates a window or a controller. The
 * Capacitor 8.5 template does both: it keeps the storyboard entry and still
 * builds a fresh CAPBridgeViewController in `willConnectTo`. Here that would
 * mean a second bridge, and one without the Game Center plugin (see
 * GameCenterPlugin.swift), so do not copy it in.
 *
 * Pause and resume need nothing from this class. The web view reports its own
 * visibility, and Capacitor 8.5's bridge listens for the scene notifications
 * itself. The callbacks below go to SceneDelegateProxy, which gives URL opens
 * and universal links to Capacitor. Foldwing registers neither today, so they
 * are there for whatever does later.
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

import UIKit
import Capacitor

/**
 * The process, not the screen.
 *
 * Under the UIScene life cycle the window, the URL opens and the foreground and
 * background transitions all belong to SceneDelegate. UIKit no longer calls the
 * AppDelegate's window, `application(_:open:options:)`,
 * `application(_:continue:restorationHandler:)` or the
 * applicationDidBecomeActive family, so they are gone from this class. Keeping
 * them would only suggest that code put there runs. It would not.
 * Anything that has to react to the app going to the background belongs in
 * SceneDelegate, or observes UIScene's notifications.
 */
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    /**
     * The configuration for a new scene session. The name matches the entry in
     * Info.plist's UIApplicationSceneManifest, and UIKit fills in the rest from
     * that entry, the storyboard included. That is what makes SceneDelegate's
     * window and FoldwingBridgeViewController appear.
     *
     * UIKit asks only when it creates a session: the first launch after an
     * install, or after the system has discarded the old one. Other launches
     * reuse the saved session and never call this, so nothing that must run on
     * every launch belongs here.
     */
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {

        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

}

native_framework = File.join(__dir__, 'native/ios/Frameworks/WeappContainerNative.xcframework/Info.plist')
unless File.file?(native_framework)
  raise 'Missing pinned iOS SDK; run node tools/prepare-native.mjs --platform ios --arch universal from sdk-react-native. No core source build fallback is available.'
end
require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
Pod::Spec.new do |s|
  s.name = "WeappContainerReactNative"
  s.version = package["version"]
  s.summary = package["description"]
  s.homepage = "https://github.com/weapp-container/sdk-react-native"
  s.license = { :type => "Apache-2.0", :file => "LICENSE" }
  s.authors = { "weapp-container" => "https://github.com/weapp-container/sdk-react-native" }
  s.source = { :git => "https://github.com/weapp-container/sdk-react-native.git", :tag => s.version.to_s }
  s.platform = :ios, "16.0"
  s.swift_version = "5.9"
  s.source_files = "ios/**/*.{h,m,mm,swift}", "native/ios/Sources/WeappContainer/**/*.swift"
  s.private_header_files = "ios/WCRNModule.h", "ios/WCRNComponentView.h"
  s.vendored_frameworks = "native/ios/Frameworks/WeappContainerNative.xcframework"
  # The generated Swift Objective-C interface references delegate protocols
  # from every installed native device adapter. Keep these imports explicit so
  # WCRNModule.mm can consume the generated header in a clean CocoaPods target.
  s.frameworks = "Metal", "MetalKit", "QuartzCore", "UIKit", "CoreGraphics", "CoreText", "CoreFoundation", "SystemConfiguration", "Security", "AVFoundation", "CoreBluetooth", "CoreLocation", "CoreMotion", "Network", "AudioToolbox", "Contacts", "ContactsUI", "EventKit", "EventKitUI", "VisionKit", "Vision", "PhotosUI", "CoreNFC", "LocalAuthentication"
  s.libraries = "c++", "z", "iconv"
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES", "SWIFT_OBJC_INTERFACE_HEADER_NAME" => "WeappContainerReactNative-Swift.h", "CLANG_CXX_LANGUAGE_STANDARD" => "c++20" }
  install_modules_dependencies(s)
end

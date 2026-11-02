#import "WCRNComponentView.h"
#import <AVFoundation/AVFoundation.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <CoreLocation/CoreLocation.h>
#import <Contacts/Contacts.h>
#import <ContactsUI/ContactsUI.h>
#import <EventKit/EventKit.h>
#import <EventKitUI/EventKitUI.h>
#import <PhotosUI/PhotosUI.h>
#import <Vision/Vision.h>
#import <VisionKit/VisionKit.h>
#import "WeappContainerReactNative-Swift.h"
#import <react/renderer/components/WeappContainerSpec/ComponentDescriptors.h>
#import <react/renderer/components/WeappContainerSpec/EventEmitters.h>
#import <react/renderer/components/WeappContainerSpec/Props.h>
#import <react/renderer/components/WeappContainerSpec/RCTComponentViewHelpers.h>
using namespace facebook::react;
@implementation WCRNComponentView {
  WCRNSurface *_surface;
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<WeappContainerNativeViewComponentDescriptor>(); }
- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _props = std::make_shared<const WeappContainerNativeViewProps>();
    _surface = [[WCRNSurface alloc] initWithFrame:self.bounds];
    self.contentView = _surface;
    __weak WCRNComponentView *weakSelf = self;
    _surface.onError = ^(NSString *code, NSString *message) {
      WCRNComponentView *owner = weakSelf;
      if (owner && owner->_eventEmitter) {
        auto emitter = std::static_pointer_cast<const WeappContainerNativeViewEventEmitter>(owner->_eventEmitter);
        emitter->onSurfaceError({std::string(code.UTF8String), std::string(message.UTF8String)});
      }
    };
  }
  return self;
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<const WeappContainerNativeViewProps>(props);
  // Fabric keeps previous props when recycling, while prepareForRecycle clears
  // our native owner. The same session must still bind on a recycled view.
  [_surface setSessionId:[NSString stringWithUTF8String:next.sessionId.c_str()]];
  [super updateProps:props oldProps:oldProps];
}
- (void)prepareForRecycle { [_surface setSessionId:@""]; [super prepareForRecycle]; }
@end
Class<RCTComponentViewProtocol> WeappContainerNativeViewCls(void) { return WCRNComponentView.class; }

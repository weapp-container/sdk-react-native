#import "WCRNModule.h"
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
#import <React/RCTInvalidating.h>
#import <React/RCTUtils.h>
#include <atomic>

@interface WCRNModule () <RCTInvalidating>
@end
@implementation WCRNModule {
  WCRNInstance *_instance;
  std::atomic_bool _invalidated;
}
RCT_EXPORT_MODULE(WeappContainer)
- (instancetype)init { if (self = [super init]) _invalidated.store(false); return self; }
+ (BOOL)requiresMainQueueSetup { return NO; }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeWeappContainerSpecJSI>(params);
}
- (WCRNInstance *)instance {
  NSAssert([NSThread isMainThread], @"Native sessions belong to the main actor");
  if (!_instance && !_invalidated) {
    _instance = [WCRNInstance new];
    __weak WCRNModule *weakSelf = self;
    _instance.onEvent = ^(NSString *sessionId, NSString *type, NSString *payload) {
      WCRNModule *owner = weakSelf;
      if (owner && !owner->_invalidated) [owner emitOnEvent:@{@"sessionId":sessionId, @"type":type, @"payload":payload}];
    };
  }
  return _instance;
}
- (void)create:(NSString *)configuration resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_invalidated) return;
    [[self instance] create:configuration completion:^(NSString *value, NSError *error) {
      if (self->_invalidated) return;
      if (error) reject(error.userInfo[@"weappCode"] ?: @"ERR_CREATE", error.localizedDescription, error); else resolve(value);
    }];
  });
}
- (void)invoke:(NSString *)sessionId operation:(NSString *)operation payload:(NSString *)payload resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_invalidated) return;
    [self instance].devicePresenter=RCTPresentedViewController();
    [[self instance] invoke:sessionId operation:operation payload:payload completion:^(NSString *value, NSError *error) {
      if (self->_invalidated) return;
      if (error) reject(error.userInfo[@"weappCode"] ?: @"ERR_OPERATION", error.localizedDescription, error); else resolve(value);
    }];
  });
}
- (void)completeHostCall:(NSString *)sessionId callId:(NSString *)callId response:(NSString *)response resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_invalidated) return;
    [[self instance] completeHostCall:sessionId callId:callId response:response completion:^(NSString *value, NSError *error) {
      if (self->_invalidated) return;
      if (error) reject(error.userInfo[@"weappCode"] ?: @"ERR_HOST_CALL", error.localizedDescription, error); else resolve(nil);
    }];
  });
}
- (void)invalidate {
  if (_invalidated.exchange(true)) return;
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_instance invalidate]; self->_instance = nil; });
}
@end

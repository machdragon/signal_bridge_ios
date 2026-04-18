#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(VoIPKeepAlive, RCTEventEmitter)
RCT_EXTERN_METHOD(register)
RCT_EXTERN_METHOD(unregister)
@end

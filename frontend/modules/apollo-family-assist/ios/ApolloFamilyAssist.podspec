Pod::Spec.new do |s|
  s.name = 'ApolloFamilyAssist'
  s.version = '1.0.0'
  s.summary = 'Apollo view-only Family Help native media bridge'
  s.description = 'Owner-consented screen capture and native-only one-to-one media transport.'
  s.author = 'HuCentAI'
  s.homepage = 'https://example.com/apollo'
  s.platforms = { :ios => '16.4' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'JitsiWebRTC', '~> 124.0.0'
  s.source_files = '*.{h,m,swift}'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'APPLICATION_EXTENSION_API_ONLY' => 'NO' }
end
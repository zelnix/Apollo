Pod::Spec.new do |s|
  s.name           = 'ApolloSecurity'
  s.version        = '1.0.0'
  s.summary        = 'Apollo iOS security module (Swift)'
  s.description    = 'Native security adapter shell for Apollo V1.'
  s.author         = 'HuCentAI'
  s.homepage       = 'https://example.com/apollo'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = "**/*.{h,m,swift}"
end

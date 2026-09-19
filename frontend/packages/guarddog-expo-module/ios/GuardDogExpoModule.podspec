require 'json'

Pod::Spec.new do |s|
  s.name           = 'GuardDogExpoModule'
  s.version        = '0.1.0'
  s.summary        = 'Guard Dog security SDK bridge (iOS: analysis/warning only in M1)'
  s.license        = 'Proprietary'
  s.author         = 'Guard Dog'
  s.homepage       = 'https://guarddog.example'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'GuardDogCore'
  s.source_files = 'GuardDogExpoModule/**/*.swift'
  s.exclude_files = 'GuardDogExpoModule/Tests/**'
end

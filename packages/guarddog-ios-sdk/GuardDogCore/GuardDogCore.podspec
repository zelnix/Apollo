Pod::Spec.new do |s|
  s.name         = 'GuardDogCore'
  s.version      = '0.1.0'
  s.summary      = 'Guard Dog core (verifier, canonicalization, events). No dependency on GuardDogNetworkFeasibility.'
  s.license      = 'Proprietary'
  s.author       = 'Guard Dog'
  s.homepage     = 'https://guarddog.example'
  s.platforms    = { :ios => '15.1' }
  s.source       = { git: '' }
  s.swift_version = '5.9'
  s.source_files = 'Sources/GuardDogCore/**/*.swift'
  s.frameworks   = 'CryptoKit'
end

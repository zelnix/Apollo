# Guard Dog — Milestone 1 (Part 4.1 + Part 5)

Monorepo layout (canonical, per the frozen execution spec):

```
apps/guarddog-mobile        -> Expo app (symlink to ./frontend, the runnable Metro root)
packages/guarddog-contracts -> shared TS contracts + node tests (source of truth; synced into the app)
packages/guarddog-android-sdk/{guarddog-core,guarddog-vpn}
packages/guarddog-expo-module/{android,ios,src}
packages/guarddog-ios-sdk/{GuardDogCore,GuardDogNetworkFeasibility}
security/test-vectors       -> cross-language fixtures (normalization, signing, jcs)
backend/app                 -> FastAPI (rules, signing, keys, intelligence, config, health)
docs/                       -> M1_TASK_BOARD.md, M1_OBSERVED_TRAFFIC_PATH.md
```

Run what is executable here:

```
cd backend && python -m pytest tests -q            # 74 tests (needs local MongoDB)
cd backend && python scripts/generate_test_vectors.py
cd packages/guarddog-contracts && yarn test        # 14 node tests
cd packages/guarddog-contracts && yarn sync-to-app # after editing shared contracts
```

Kotlin/Swift: code-review ready, not runtime-verified here (see docs/M1_OBSERVED_TRAFFIC_PATH.md).
Secrets: `backend/.env` (gitignored) holds the M1 test-only Ed25519 seeds; `backend/.env.example` lists variable names only.

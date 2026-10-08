// Gates is a normal secondary stack route (iOS native tabs cannot reliably open a hidden tab), reachable at
// /gates. The legacy /(tabs)/guard route still resolves to the same screen for older deep links.
export { default } from "./(tabs)/guard";

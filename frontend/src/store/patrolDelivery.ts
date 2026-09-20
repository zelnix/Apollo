import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiPost } from '../api/client';
import { DeliveryQueue, type DeliveryStatus } from './deliveryQueue';

let status: DeliveryStatus = { pending: 0, blocked: 0, error: null };
const listeners = new Set<(s: DeliveryStatus) => void>();
export const deliveryStatus = () => status;
export const onDeliveryStatus = (fn: (s: DeliveryStatus) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function deliveryFailure() {
  status = { ...status, error: 'Patrol could not save its delivery queue. Retry before closing Apollo.' };
  listeners.forEach(fn => fn(status));
}
export const patrolDelivery = new DeliveryQueue({
  read: () => AsyncStorage.getItem('apollo.patrol.delivery.v1'),
  write: value => AsyncStorage.setItem('apollo.patrol.delivery.v1', value),
  send: payload => apiPost('/patrol/events', 'patrol_sync', payload),
  changed: s => { status = s; listeners.forEach(fn => fn(s)); },
});
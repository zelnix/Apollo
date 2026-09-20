import React, { useEffect, useState } from 'react';
import { Body, Button, Card } from './ui';
import { deliveryStatus, onDeliveryStatus, patrolDelivery, deliveryFailure } from '../store/patrolDelivery';
import { useApollo } from '../store/ApolloContext';

export function PatrolDeliveryBanner() {
  const [status, setStatus] = useState(deliveryStatus);
  const [busy, setBusy] = useState(false);
  const { deviceId } = useApollo();
  useEffect(() => onDeliveryStatus(setStatus), []);
  if (!status.pending && !status.error) return null;
  const retry = async () => {
    if (!deviceId) return;
    setBusy(true);
    try { await patrolDelivery.flush(deviceId, true); } catch { deliveryFailure(); } finally { setBusy(false); }
  };
  return <Card testID="patrol-delivery-banner">
    <Body testID="patrol-delivery-count">{status.pending} event(s) awaiting server acknowledgement</Body>
    <Body testID="patrol-delivery-error">{status.error ?? 'Saved locally. Delivery is pending; family alerts may not have arrived.'}</Body>
    <Button testID="patrol-delivery-retry" label={busy ? 'Retrying…' : 'Retry delivery'} onPress={() => void retry()} disabled={busy || !deviceId} />
  </Card>;
}
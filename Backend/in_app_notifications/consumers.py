from channels.generic.websocket import AsyncJsonWebsocketConsumer

REALTIME_DEFERRED_CLOSE_CODE = 4403


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        await self.close(code=REALTIME_DEFERRED_CLOSE_CODE)

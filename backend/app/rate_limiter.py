from slowapi import Limiter
from slowapi.util import get_remote_address


# Shared limiter instance for routers and app setup.
limiter = Limiter(key_func=get_remote_address)
"""Small thread-safe TTL + LRU cache with per-entry deadlines."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Hashable
from typing import Generic, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class TTLCache(Generic[K, V]):
    """Bounded mapping whose entries expire individually.

    Each ``set`` carries its own TTL so callers can cap an entry's lifetime
    (e.g. by a JWT ``exp``). When full, expired entries are purged first, then
    the least recently used entry is evicted. All operations hold a lock and
    never await, so the cache is safe from both threads and coroutines.
    """

    def __init__(self, maxsize: int, clock: Callable[[], float] = time.monotonic) -> None:
        if maxsize < 1:
            raise ValueError("maxsize must be >= 1")
        self._maxsize = maxsize
        self.clock = clock
        self._data: OrderedDict[K, tuple[float, V]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: K) -> V | None:
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            deadline, value = entry
            if self.clock() >= deadline:
                del self._data[key]
                return None
            self._data.move_to_end(key)
            return value

    def set(self, key: K, value: V, ttl: float) -> None:
        """Store ``value`` for ``ttl`` seconds; non-positive TTLs are ignored."""
        if ttl <= 0:
            return
        with self._lock:
            now = self.clock()
            self._data[key] = (now + ttl, value)
            self._data.move_to_end(key)
            if len(self._data) > self._maxsize:
                self._purge_expired_locked(now)
            while len(self._data) > self._maxsize:
                self._data.popitem(last=False)

    def pop(self, key: K) -> None:
        with self._lock:
            self._data.pop(key, None)

    def discard_where(self, predicate: Callable[[K, V], bool]) -> int:
        """Remove every entry for which ``predicate(key, value)`` is true."""
        with self._lock:
            doomed = [key for key, (_, value) in self._data.items() if predicate(key, value)]
            for key in doomed:
                del self._data[key]
            return len(doomed)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)

    def _purge_expired_locked(self, now: float) -> None:
        expired = [key for key, (deadline, _) in self._data.items() if now >= deadline]
        for key in expired:
            del self._data[key]

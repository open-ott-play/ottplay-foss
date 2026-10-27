package play.ott.foss

/** Per-scan index; replacing a preferred item must not count it twice. */
internal class LocalMediaAvailability {
    private data class Item(val sourceId: String, val available: Boolean)
    private val items = mutableMapOf<String, Item>()
    private val sourceItems = mutableMapOf<String, Int>()
    private val sourceAvailable = mutableMapOf<String, Int>()
    private var availableItems = 0

    fun update(id: String, sourceId: String, available: Boolean) {
        val item = Item(sourceId, available)
        items.put(id, item)?.let { previous -> adjust(previous, -1) }
        adjust(item, 1)
    }

    private fun adjust(item: Item, delta: Int) {
        val count = (sourceItems[item.sourceId] ?: 0) + delta
        if (count == 0) sourceItems.remove(item.sourceId) else sourceItems[item.sourceId] = count
        if (item.available) {
            availableItems += delta
            val available = (sourceAvailable[item.sourceId] ?: 0) + delta
            if (available == 0) sourceAvailable.remove(item.sourceId) else sourceAvailable[item.sourceId] = available
        }
    }

    fun containsSource(sourceId: String): Boolean = sourceItems.containsKey(sourceId)
    fun sourceIsAvailable(sourceId: String): Boolean = sourceAvailable.containsKey(sourceId)
    fun anyAvailable(): Boolean = availableItems > 0
}

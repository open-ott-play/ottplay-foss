import assert from "assert";

async function getModule() {
    return await import("../src/channels/index.ts");
}

async function runTests() {
    const ch = await getModule();
    const {
        getFilteredHistory,
        getFilteredChannelList,
        searchHistoryChannel,
        searchChannel,
        medHistory,
        curList,
        chanels,
        historySearchText,
        searchText,
    } = ch;

    // Helper to reset state
    function resetState() {
        medHistory.splice(0);
        curList.splice(0);
        // Clear chanels (which is the same as channels)
        for (const key of Object.keys(chanels)) {
            delete chanels[key];
        }
        // Reset search strings via setter functions
        searchHistoryChannel("");
        searchChannel("");
    }

    // Test getFilteredHistory
    {
        resetState();
        const result = getFilteredHistory();
        assert.deepStrictEqual(
            result,
            [],
            "getFilteredHistory should return empty array when medHistory is empty"
        );
    }

    {
        resetState();
        medHistory.push(
            { ch_id: 1, name: "Channel 1", title: "Show 1" },
            { ch_id: 2, name: "Channel 2", title: "Show 2" }
        );
        const result = getFilteredHistory();
        assert.deepStrictEqual(
            result,
            medHistory,
            "getFilteredHistory should return all medHistory when historySearchText is empty"
        );
    }

    {
        resetState();
        medHistory.push(
            { ch_id: 1, name: "BBC News", title: "News Hour" },
            { ch_id: 2, name: "EuroSport", title: "Football Live" }
        );
        searchHistoryChannel("bbc");
        const result = getFilteredHistory();
        assert.strictEqual(
            result.length,
            1,
            "getFilteredHistory should filter by name (bbc)"
        );
        assert.strictEqual(
            result[0].name,
            "BBC News",
            "getFilteredHistory should match the correct channel by name"
        );
    }

    {
        resetState();
        medHistory.push(
            { ch_id: 1, name: "BBC News", title: "News Hour" },
            { ch_id: 2, name: "EuroSport", title: "Football Live" }
        );
        searchHistoryChannel("football");
        const result = getFilteredHistory();
        assert.strictEqual(
            result.length,
            1,
            "getFilteredHistory should filter by title (football)"
        );
        assert.strictEqual(
            result[0].title,
            "Football Live",
            "getFilteredHistory should match the correct channel by title"
        );
    }

    {
        resetState();
        medHistory.push({ ch_id: 1, name: "BBC News", title: "News Hour" });
        searchHistoryChannel("BBC");
        const result = getFilteredHistory();
        assert.strictEqual(
            result.length,
            1,
            "getFilteredHistory should be case-insensitive for name"
        );
    }

    {
        resetState();
        medHistory.push({ ch_id: 1, name: "BBC News", title: "News Hour" });
        searchHistoryChannel("CNN");
        const result = getFilteredHistory();
        assert.deepStrictEqual(
            result,
            [],
            "getFilteredHistory should return empty array when no match"
        );
    }

    // Test getFilteredChannelList
    {
        resetState();
        const result = getFilteredChannelList();
        assert.deepStrictEqual(
            result,
            [],
            "getFilteredChannelList should return empty array when curList is empty"
        );
    }

    {
        resetState();
        curList.push(1, 2, 3);
        chanels[1] = { ch_id: 1, channel_name: "CNN", name: "CNN" };
        chanels[2] = { ch_id: 2, channel_name: "BBC", name: "BBC One" };
        chanels[3] = { ch_id: 3, channel_name: "ESPN", name: "ESPN" };
        const result = getFilteredChannelList();
        assert.deepStrictEqual(
            result,
            [1, 2, 3],
            "getFilteredChannelList should return all curList when searchText is empty"
        );
    }

    {
        resetState();
        curList.push(1, 2, 3);
        chanels[1] = { ch_id: 1, channel_name: "CNN", name: "CNN" };
        chanels[2] = { ch_id: 2, channel_name: "BBC", name: "BBC One" };
        chanels[3] = { ch_id: 3, channel_name: "ESPN", name: "ESPN" };
        searchChannel("bbc");
        const result = getFilteredChannelList();
        assert.deepStrictEqual(
            result,
            [2],
            "getFilteredChannelList should filter by channel_name (bbc)"
        );
    }

    {
        resetState();
        curList.push(1, 2, 3);
        chanels[1] = { ch_id: 1, channel_name: "CNN", name: "CNN" };
        chanels[2] = { ch_id: 2, channel_name: "BBC", name: "BBC One" };
        chanels[3] = { ch_id: 3, channel_name: "ESPN", name: "ESPN" };
        searchChannel("espn");
        const result = getFilteredChannelList();
        assert.deepStrictEqual(
            result,
            [3],
            "getFilteredChannelList should filter by name (espn)"
        );
    }

    {
        resetState();
        curList.push(1, 2);
        chanels[1] = { ch_id: 1, channel_name: "CNN", name: "CNN" };
        chanels[2] = { ch_id: 2, channel_name: "BBC", name: "BBC One" };
        searchChannel("CNN");
        const result = getFilteredChannelList();
        assert.deepStrictEqual(
            result,
            [1],
            "getFilteredChannelList should be case-insensitive for channel_name"
        );
    }

    {
        resetState();
        curList.push(1, 2);
        chanels[1] = { ch_id: 1, channel_name: "CNN", name: "CNN" };
        chanels[2] = { ch_id: 2, channel_name: "BBC", name: "BBC One" };
        searchChannel("Fox");
        const result = getFilteredChannelList();
        assert.deepStrictEqual(
            result,
            [],
            "getFilteredChannelList should return empty array when no match"
        );
    }

    console.log("Channel filtering tests passed!");
}

runTests().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});

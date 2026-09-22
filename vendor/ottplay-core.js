//region block: polyfills
(function () {
  if (typeof globalThis === 'object')
    return;
  Object.defineProperty(Object.prototype, '__magic__', {get: function () {
    return this;
  }, configurable: true});
  __magic__.globalThis = __magic__;
  delete Object.prototype.__magic__;
}());
if (typeof Math.imul === 'undefined') {
  Math.imul = function imul(a, b) {
    return (a & 4.29490176E9) * (b & 65535) + (a & 65535) * (b | 0) | 0;
  };
}
if (typeof ArrayBuffer.isView === 'undefined') {
  ArrayBuffer.isView = function (a) {
    return a != null && a.__proto__ != null && a.__proto__.__proto__ === Int8Array.prototype.__proto__;
  };
}
if (typeof Array.prototype.fill === 'undefined') {
  // Polyfill from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/fill#Polyfill
  Object.defineProperty(Array.prototype, 'fill', {value: function (value) {
    // Steps 1-2.
    if (this == null) {
      throw new TypeError('this is null or not defined');
    }
    var O = Object(this); // Steps 3-5.
    var len = O.length >>> 0; // Steps 6-7.
    var start = arguments[1];
    var relativeStart = start >> 0; // Step 8.
    var k = relativeStart < 0 ? Math.max(len + relativeStart, 0) : Math.min(relativeStart, len); // Steps 9-10.
    var end = arguments[2];
    var relativeEnd = end === undefined ? len : end >> 0; // Step 11.
    var finalValue = relativeEnd < 0 ? Math.max(len + relativeEnd, 0) : Math.min(relativeEnd, len); // Step 12.
    while (k < finalValue) {
      O[k] = value;
      k++;
    }
    ; // Step 13.
    return O;
  }});
}
[Int8Array, Int16Array, Uint16Array, Int32Array, Float32Array, Float64Array].forEach(function (TypedArray) {
  if (typeof TypedArray.prototype.fill === 'undefined') {
    Object.defineProperty(TypedArray.prototype, 'fill', {value: Array.prototype.fill});
  }
});
if (typeof Math.clz32 === 'undefined') {
  Math.clz32 = function (log, LN2) {
    return function (x) {
      var asUint = x >>> 0;
      if (asUint === 0) {
        return 32;
      }
      return 31 - (log(asUint) / LN2 | 0) | 0; // the "| 0" acts like math.floor
    };
  }(Math.log, Math.LN2);
}
if (typeof String.prototype.endsWith === 'undefined') {
  Object.defineProperty(String.prototype, 'endsWith', {value: function (searchString, position) {
    var subjectString = this.toString();
    if (position === undefined || position > subjectString.length) {
      position = subjectString.length;
    }
    position -= searchString.length;
    var lastIndex = subjectString.indexOf(searchString, position);
    return lastIndex !== -1 && lastIndex === position;
  }});
}
if (typeof String.prototype.startsWith === 'undefined') {
  Object.defineProperty(String.prototype, 'startsWith', {value: function (searchString, position) {
    position = position || 0;
    return this.lastIndexOf(searchString, position) === position;
  }});
}
//endregion
(function (factory) {
  if (typeof define === 'function' && define.amd)
    define(['exports'], factory);
  else if (typeof exports === 'object')
    factory(module.exports);
  else
    globalThis['play.ott:ottplay-shared-core'] = factory(typeof globalThis['play.ott:ottplay-shared-core'] === 'undefined' ? {} : globalThis['play.ott:ottplay-shared-core']);
}(function (_) {
  'use strict';
  //region block: imports
  var imul = Math.imul;
  var isView = ArrayBuffer.isView;
  var clz32 = Math.clz32;
  //endregion
  //region block: pre-declaration
  initMetadataForInterface(CharSequence, 'CharSequence');
  initMetadataForInterface(Comparable, 'Comparable');
  initMetadataForClass(Number_0, 'Number');
  initMetadataForClass(asIterable$$inlined$Iterable$1);
  initMetadataForCompanion(Companion);
  initMetadataForClass(Char, 'Char', VOID, VOID, [Comparable]);
  initMetadataForInterface(Collection, 'Collection');
  initMetadataForInterface(KtSet, 'Set', VOID, VOID, [Collection]);
  initMetadataForInterface(KtList, 'List', VOID, VOID, [Collection]);
  initMetadataForInterface(Entry, 'Entry');
  initMetadataForInterface(KtMap, 'Map');
  initMetadataForInterface(KtMutableMap, 'MutableMap', VOID, VOID, [KtMap]);
  initMetadataForCompanion(Companion_0);
  initMetadataForClass(Enum, 'Enum', VOID, VOID, [Comparable]);
  initMetadataForCompanion(Companion_1);
  initMetadataForClass(Long, 'Long', VOID, Number_0, [Comparable]);
  initMetadataForInterface(FunctionAdapter, 'FunctionAdapter');
  initMetadataForObject(Digit, 'Digit');
  initMetadataForInterface(Comparator, 'Comparator');
  initMetadataForObject(Unit, 'Unit');
  initMetadataForClass(AbstractCollection, 'AbstractCollection', VOID, VOID, [Collection]);
  initMetadataForClass(AbstractMutableCollection, 'AbstractMutableCollection', VOID, AbstractCollection, [Collection]);
  initMetadataForClass(IteratorImpl, 'IteratorImpl');
  initMetadataForClass(ListIteratorImpl, 'ListIteratorImpl', VOID, IteratorImpl);
  initMetadataForClass(AbstractMutableList, 'AbstractMutableList', VOID, AbstractMutableCollection, [Collection, KtList]);
  initMetadataForInterface(RandomAccess, 'RandomAccess');
  initMetadataForClass(SubList, 'SubList', VOID, AbstractMutableList, [RandomAccess]);
  initMetadataForClass(AbstractMap, 'AbstractMap', VOID, VOID, [KtMap]);
  initMetadataForClass(AbstractMutableMap, 'AbstractMutableMap', VOID, AbstractMap, [KtMutableMap]);
  initMetadataForClass(AbstractMutableSet, 'AbstractMutableSet', VOID, AbstractMutableCollection, [Collection, KtSet]);
  initMetadataForCompanion(Companion_2);
  initMetadataForClass(ArrayList, 'ArrayList', ArrayList_init_$Create$, AbstractMutableList, [Collection, KtList, RandomAccess]);
  initMetadataForClass(HashMap, 'HashMap', HashMap_init_$Create$, AbstractMutableMap, [KtMutableMap]);
  initMetadataForClass(HashMapKeys, 'HashMapKeys', VOID, AbstractMutableSet, [Collection, KtSet]);
  initMetadataForClass(HashMapValues, 'HashMapValues', VOID, AbstractMutableCollection, [Collection]);
  initMetadataForClass(HashMapEntrySetBase, 'HashMapEntrySetBase', VOID, AbstractMutableSet, [Collection, KtSet]);
  initMetadataForClass(HashMapEntrySet, 'HashMapEntrySet', VOID, HashMapEntrySetBase);
  initMetadataForClass(HashMapKeysDefault$iterator$1);
  initMetadataForClass(HashMapKeysDefault, 'HashMapKeysDefault', VOID, AbstractMutableSet);
  initMetadataForClass(HashMapValuesDefault$iterator$1);
  initMetadataForClass(HashMapValuesDefault, 'HashMapValuesDefault', VOID, AbstractMutableCollection);
  initMetadataForClass(HashSet, 'HashSet', HashSet_init_$Create$, AbstractMutableSet, [Collection, KtSet]);
  initMetadataForCompanion(Companion_3);
  initMetadataForClass(Itr, 'Itr');
  initMetadataForClass(KeysItr, 'KeysItr', VOID, Itr);
  initMetadataForClass(ValuesItr, 'ValuesItr', VOID, Itr);
  initMetadataForClass(EntriesItr, 'EntriesItr', VOID, Itr);
  initMetadataForClass(EntryRef, 'EntryRef', VOID, VOID, [Entry]);
  function containsAllEntries(m) {
    var tmp$ret$0;
    $l$block_0: {
      // Inline function 'kotlin.collections.all' call
      var tmp;
      if (isInterface(m, Collection)) {
        tmp = m.isEmpty_y1axqb_k$();
      } else {
        tmp = false;
      }
      if (tmp) {
        tmp$ret$0 = true;
        break $l$block_0;
      }
      var _iterator__ex2g4s = m.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        // Inline function 'kotlin.js.unsafeCast' call
        // Inline function 'kotlin.js.asDynamic' call
        var entry = element;
        var tmp_0;
        if (!(entry == null) ? isInterface(entry, Entry) : false) {
          tmp_0 = this.containsOtherEntry_yvdc55_k$(entry);
        } else {
          tmp_0 = false;
        }
        if (!tmp_0) {
          tmp$ret$0 = false;
          break $l$block_0;
        }
      }
      tmp$ret$0 = true;
    }
    return tmp$ret$0;
  }
  initMetadataForInterface(InternalMap, 'InternalMap');
  initMetadataForClass(InternalHashMap, 'InternalHashMap', InternalHashMap_init_$Create$, VOID, [InternalMap]);
  initMetadataForClass(LinkedHashMap, 'LinkedHashMap', LinkedHashMap_init_$Create$, HashMap, [KtMutableMap]);
  initMetadataForClass(LinkedHashSet, 'LinkedHashSet', LinkedHashSet_init_$Create$, HashSet, [Collection, KtSet]);
  initMetadataForClass(Exception, 'Exception', Exception_init_$Create$, Error);
  initMetadataForClass(RuntimeException, 'RuntimeException', RuntimeException_init_$Create$, Exception);
  initMetadataForClass(UnsupportedOperationException, 'UnsupportedOperationException', UnsupportedOperationException_init_$Create$, RuntimeException);
  initMetadataForClass(IllegalArgumentException, 'IllegalArgumentException', IllegalArgumentException_init_$Create$, RuntimeException);
  initMetadataForClass(NoSuchElementException, 'NoSuchElementException', NoSuchElementException_init_$Create$, RuntimeException);
  initMetadataForClass(IndexOutOfBoundsException, 'IndexOutOfBoundsException', IndexOutOfBoundsException_init_$Create$, RuntimeException);
  initMetadataForClass(IllegalStateException, 'IllegalStateException', IllegalStateException_init_$Create$, RuntimeException);
  initMetadataForClass(ConcurrentModificationException, 'ConcurrentModificationException', ConcurrentModificationException_init_$Create$, RuntimeException);
  initMetadataForClass(ArithmeticException, 'ArithmeticException', ArithmeticException_init_$Create$, RuntimeException);
  initMetadataForClass(NumberFormatException, 'NumberFormatException', NumberFormatException_init_$Create$, IllegalArgumentException);
  initMetadataForClass(NoWhenBranchMatchedException, 'NoWhenBranchMatchedException', NoWhenBranchMatchedException_init_$Create$, RuntimeException);
  initMetadataForClass(NullPointerException, 'NullPointerException', NullPointerException_init_$Create$, RuntimeException);
  initMetadataForClass(ClassCastException, 'ClassCastException', ClassCastException_init_$Create$, RuntimeException);
  initMetadataForClass(KClassImpl, 'KClassImpl');
  initMetadataForClass(PrimitiveKClassImpl, 'PrimitiveKClassImpl', VOID, KClassImpl);
  initMetadataForObject(NothingKClassImpl, 'NothingKClassImpl', VOID, KClassImpl);
  initMetadataForInterface(KProperty0, 'KProperty0');
  initMetadataForClass(CharacterCodingException, 'CharacterCodingException', CharacterCodingException_init_$Create$, Exception);
  initMetadataForClass(StringBuilder, 'StringBuilder', StringBuilder_init_$Create$_0, VOID, [CharSequence]);
  initMetadataForClass(sam$kotlin_Comparator$0, 'sam$kotlin_Comparator$0', VOID, VOID, [Comparator, FunctionAdapter]);
  initMetadataForClass(AbstractList, 'AbstractList', VOID, AbstractCollection, [KtList]);
  initMetadataForClass(SubList_0, 'SubList', VOID, AbstractList, [RandomAccess]);
  initMetadataForClass(IteratorImpl_0, 'IteratorImpl');
  initMetadataForClass(ListIteratorImpl_0, 'ListIteratorImpl', VOID, IteratorImpl_0);
  initMetadataForCompanion(Companion_4);
  initMetadataForClass(AbstractMap$keys$1$iterator$1);
  initMetadataForClass(AbstractMap$values$1$iterator$1);
  initMetadataForCompanion(Companion_5);
  initMetadataForClass(AbstractSet, 'AbstractSet', VOID, AbstractCollection, [KtSet]);
  initMetadataForClass(AbstractMap$keys$1, VOID, VOID, AbstractSet);
  initMetadataForClass(AbstractMap$values$1, VOID, VOID, AbstractCollection);
  initMetadataForCompanion(Companion_6);
  initMetadataForObject(EmptyList, 'EmptyList', VOID, VOID, [KtList, RandomAccess]);
  initMetadataForObject(EmptyIterator, 'EmptyIterator');
  initMetadataForClass(IndexedValue, 'IndexedValue');
  initMetadataForClass(IndexingIterable, 'IndexingIterable');
  initMetadataForClass(IndexingIterator, 'IndexingIterator');
  initMetadataForInterface(MapWithDefault, 'MapWithDefault', VOID, VOID, [KtMap]);
  initMetadataForObject(EmptyMap, 'EmptyMap', VOID, VOID, [KtMap]);
  initMetadataForClass(CharIterator, 'CharIterator');
  initMetadataForClass(IntIterator, 'IntIterator');
  initMetadataForObject(EmptySet, 'EmptySet', VOID, VOID, [KtSet]);
  initMetadataForClass(EnumEntriesList, 'EnumEntriesList', VOID, AbstractList, [KtList, RandomAccess]);
  initMetadataForCompanion(Companion_7);
  initMetadataForClass(CharProgression, 'CharProgression');
  initMetadataForClass(CharRange, 'CharRange', VOID, CharProgression);
  initMetadataForCompanion(Companion_8);
  initMetadataForClass(IntProgression, 'IntProgression');
  initMetadataForClass(IntRange, 'IntRange', VOID, IntProgression);
  initMetadataForClass(CharProgressionIterator, 'CharProgressionIterator', VOID, CharIterator);
  initMetadataForClass(IntProgressionIterator, 'IntProgressionIterator', VOID, IntIterator);
  initMetadataForCompanion(Companion_9);
  initMetadataForCompanion(Companion_10);
  initMetadataForClass(DelimitedRangesSequence$iterator$1);
  initMetadataForClass(DelimitedRangesSequence, 'DelimitedRangesSequence');
  initMetadataForObject(State, 'State');
  initMetadataForClass(LinesIterator, 'LinesIterator');
  initMetadataForClass(iterator$1, VOID, VOID, CharIterator);
  initMetadataForClass(lineSequence$$inlined$Sequence$1);
  initMetadataForClass(UnsafeLazyImpl, 'UnsafeLazyImpl');
  initMetadataForObject(UNINITIALIZED_VALUE, 'UNINITIALIZED_VALUE');
  initMetadataForClass(Pair, 'Pair');
  initMetadataForClass(Triple, 'Triple');
  initMetadataForClass(ArchiveFormat, 'ArchiveFormat', VOID, Enum);
  initMetadataForClass(ArchiveRequest, 'ArchiveRequest');
  initMetadataForClass(Archive$Span$values$1, VOID, VOID, VOID, [KtMap]);
  initMetadataForClass(Span, 'Span');
  initMetadataForClass(TemplateFormat, 'TemplateFormat', VOID, Enum);
  initMetadataForClass(Resource, 'Resource');
  initMetadataForObject(Archive, 'Archive');
  initMetadataForObject(CoreText, 'CoreText');
  initMetadataForClass(Slot, 'Slot');
  initMetadataForCompanion(Companion_11);
  initMetadataForClass(GuideLookupCache, 'GuideLookupCache');
  initMetadataForObject(GuideResponseCache, 'GuideResponseCache');
  initMetadataForClass(LegacyGuideSelection, 'LegacyGuideSelection');
  initMetadataForClass(sam$kotlin_Comparator$0_0, 'sam$kotlin_Comparator$0', VOID, VOID, [Comparator, FunctionAdapter]);
  initMetadataForObject(LegacyGuideSchedule, 'LegacyGuideSchedule');
  initMetadataForObject(GuideProgrammeRules, 'GuideProgrammeRules');
  initMetadataForCompanion(Companion_12);
  initMetadataForClass(GuideCoverage, 'GuideCoverage', GuideCoverage);
  initMetadataForClass(GuideStation, 'GuideStation');
  initMetadataForClass(GuideRecord, 'GuideRecord');
  initMetadataForClass(GuideRawStation, 'GuideRawStation');
  initMetadataForClass(GuideRawProgramme, 'GuideRawProgramme');
  initMetadataForClass(GuideCatalog, 'GuideCatalog', GuideCatalog);
  initMetadataForClass(GuideFeedInput, 'GuideFeedInput');
  initMetadataForClass(GuideFeedGroup, 'GuideFeedGroup');
  initMetadataForClass(GuideMerge, 'GuideMerge');
  initMetadataForClass(GuideParsed, 'GuideParsed');
  initMetadataForClass(sam$kotlin_Comparator$0_1, 'sam$kotlin_Comparator$0', VOID, VOID, [Comparator, FunctionAdapter]);
  initMetadataForClass(sam$kotlin_Comparator$0_2, 'sam$kotlin_Comparator$0', VOID, VOID, [Comparator, FunctionAdapter]);
  initMetadataForClass(sam$kotlin_Comparator$0_3, 'sam$kotlin_Comparator$0', VOID, VOID, [Comparator, FunctionAdapter]);
  initMetadataForObject(GuideFeeds, 'GuideFeeds');
  initMetadataForObject(GuideNames, 'GuideNames');
  initMetadataForClass(GuideWindow, 'GuideWindow');
  initMetadataForClass(GuideScheduleMemo, 'GuideScheduleMemo', GuideScheduleMemo);
  initMetadataForObject(GuideSchedule, 'GuideSchedule');
  initMetadataForClass(GuideTimeFormat, 'GuideTimeFormat', VOID, Enum);
  initMetadataForClass(NativeGuideClock, 'NativeGuideClock');
  initMetadataForObject(GuideTime, 'GuideTime');
  initMetadataForClass(LegacyStalkerEntry, 'LegacyStalkerEntry');
  initMetadataForClass(LegacyStalkerCatalog, 'LegacyStalkerCatalog');
  initMetadataForClass(LegacyStalker, 'LegacyStalker');
  initMetadataForClass(LegacyXtreamEntry, 'LegacyXtreamEntry');
  initMetadataForClass(LegacyXtreamCatalog, 'LegacyXtreamCatalog');
  initMetadataForClass(LegacyXtreamProgramme, 'LegacyXtreamProgramme');
  initMetadataForObject(LegacyXtream, 'LegacyXtream');
  initMetadataForClass(NativeGuideFormat, 'NativeGuideFormat', VOID, Enum);
  initMetadataForClass(Shift, 'Shift');
  initMetadataForObject(NativeGuideNames, 'NativeGuideNames');
  initMetadataForClass(NativeGuideEntry, 'NativeGuideEntry');
  initMetadataForClass(NativeGuideMatch, 'NativeGuideMatch');
  initMetadataForClass(Name, 'Name');
  initMetadataForClass(NativeGuideIndex, 'NativeGuideIndex');
  initMetadataForClass(NativeGuideWindow, 'NativeGuideWindow');
  initMetadataForClass(NativeSourceFormat, 'NativeSourceFormat', VOID, Enum);
  initMetadataForClass(NativeCacheLookup, 'NativeCacheLookup', VOID, Enum);
  initMetadataForClass(NativeCacheRefresh, 'NativeCacheRefresh', VOID, Enum);
  initMetadataForObject(NativeGuideSources, 'NativeGuideSources');
  initMetadataForClass(NativeSourceLoadAction, 'NativeSourceLoadAction', VOID, Enum);
  initMetadataForObject(NativeSourceLoad, 'NativeSourceLoad');
  initMetadataForClass(NativeSourceBatch, 'NativeSourceBatch');
  initMetadataForClass(OperatorEntry, 'OperatorEntry');
  initMetadataForClass(OperatorCatalog, 'OperatorCatalog');
  initMetadataForClass(PlaylistMedia, 'PlaylistMedia');
  initMetadataForObject(OperatorPlaylist, 'OperatorPlaylist');
  initMetadataForClass(PlaylistFormat, 'PlaylistFormat', VOID, Enum);
  initMetadataForClass(PlaylistFailure, 'PlaylistFailure', VOID, Exception);
  initMetadataForClass(PlaylistDirective, 'PlaylistDirective');
  initMetadataForClass(PlaylistArchive, 'PlaylistArchive');
  initMetadataForClass(PlaylistEntry, 'PlaylistEntry');
  initMetadataForClass(PlaylistResult, 'PlaylistResult');
  initMetadataForObject(Playlist, 'Playlist');
  initMetadataForClass(ProviderPlaylistFormat, 'ProviderPlaylistFormat', VOID, Enum);
  initMetadataForClass(ProviderPlaylistEntry, 'ProviderPlaylistEntry');
  initMetadataForClass(ProviderPlaylistResult, 'ProviderPlaylistResult');
  initMetadataForObject(ProviderPlaylist, 'ProviderPlaylist');
  initMetadataForClass(ProviderValueKind, 'ProviderValueKind', VOID, Enum);
  initMetadataForCompanion(Companion_13);
  initMetadataForClass(ProviderValue, 'ProviderValue');
  initMetadataForObject(CoreNumber, 'CoreNumber');
  initMetadataForClass(StalkerBrowserSession, 'StalkerBrowserSession');
  initMetadataForClass(StalkerBrowserOperation, 'StalkerBrowserOperation');
  initMetadataForClass(StalkerPages, 'StalkerPages');
  initMetadataForObject(StalkerCatalogs, 'StalkerCatalogs');
  initMetadataForClass(StalkerFormat, 'StalkerFormat', VOID, Enum);
  initMetadataForClass(StalkerFailure, 'StalkerFailure', VOID, Exception);
  initMetadataForClass(StalkerRequest, 'StalkerRequest');
  initMetadataForClass(StalkerLocation, 'StalkerLocation');
  initMetadataForClass(StalkerItem, 'StalkerItem');
  initMetadataForClass(StalkerResult, 'StalkerResult');
  initMetadataForObject(StalkerProtocol, 'StalkerProtocol');
  initMetadataForClass(StreamingGuideIdentity, 'StreamingGuideIdentity');
  initMetadataForClass(StreamingGuideCoverage, 'StreamingGuideCoverage');
  initMetadataForClass(Entry_0, 'Entry');
  initMetadataForCompanion(Companion_14);
  initMetadataForClass(sam$kotlin_Comparator$0_4, 'sam$kotlin_Comparator$0', VOID, VOID, [Comparator, FunctionAdapter]);
  initMetadataForClass(StreamingGuide, 'StreamingGuide');
  initMetadataForClass(XmltvRecordFormat, 'XmltvRecordFormat', VOID, Enum);
  initMetadataForClass(sam$kotlin_Comparator$0_5, 'sam$kotlin_Comparator$0', VOID, VOID, [Comparator, FunctionAdapter]);
  initMetadataForObject(NativeRecordRules, 'NativeRecordRules');
  initMetadataForClass(Time, 'Time');
  initMetadataForClass(XmltvRecords, 'XmltvRecords');
  initMetadataForClass(XtreamItem, 'XtreamItem');
  initMetadataForClass(XtreamCatalog, 'XtreamCatalog');
  initMetadataForClass(XtreamSeries, 'XtreamSeries');
  initMetadataForClass(XtreamSeriesParent, 'XtreamSeriesParent');
  initMetadataForClass(sam$kotlin_Comparator$0_6, 'sam$kotlin_Comparator$0', VOID, VOID, [Comparator, FunctionAdapter]);
  initMetadataForClass(sam$kotlin_Comparator$0_7, 'sam$kotlin_Comparator$0', VOID, VOID, [Comparator, FunctionAdapter]);
  initMetadataForObject(XtreamCatalogs, 'XtreamCatalogs');
  initMetadataForClass(XtreamFormat, 'XtreamFormat', VOID, Enum);
  initMetadataForClass(XtreamFailure, 'XtreamFailure', VOID, Exception);
  initMetadataForClass(XtreamRequest, 'XtreamRequest');
  initMetadataForClass(XtreamSession, 'XtreamSession');
  initMetadataForClass(XtreamSource, 'XtreamSource');
  initMetadataForCompanion(Companion_15);
  initMetadataForClass(XtreamAddresses, 'XtreamAddresses');
  initMetadataForClass(ScheduleSelection, 'ScheduleSelection');
  initMetadataForClass(NativeMatch, 'NativeMatch');
  initMetadataForClass(NativeGuide, 'NativeGuide');
  initMetadataForClass(BrowserGuideLookup, 'BrowserGuideLookup');
  initMetadataForClass(GuideModels, 'GuideModels');
  initMetadataForClass(BrowserLookupItem, 'BrowserLookupItem');
  initMetadataForClass(NativeGuideSourceBatch, 'NativeGuideSourceBatch');
  initMetadataForClass(StalkerClient, 'StalkerClient');
  initMetadataForClass(LegacyStalkerClient, 'LegacyStalkerClient');
  initMetadataForClass(StreamingGuideFilter, 'StreamingGuideFilter');
  initMetadataForClass(XmltvRecords_0, 'XmltvRecords');
  initMetadataForClass(XtreamClient, 'XtreamClient');
  //endregion
  function CharSequence() {
  }
  function Comparable() {
  }
  function Number_0() {
  }
  function throwUnsupportedOperationException(message) {
    throw UnsupportedOperationException_init_$Create$_0(message);
  }
  function indexOf(_this__u8e3s4, element) {
    if (element == null) {
      var inductionVariable = 0;
      var last = _this__u8e3s4.length - 1 | 0;
      if (inductionVariable <= last)
        do {
          var index = inductionVariable;
          inductionVariable = inductionVariable + 1 | 0;
          if (_this__u8e3s4[index] == null) {
            return index;
          }
        }
         while (inductionVariable <= last);
    } else {
      var inductionVariable_0 = 0;
      var last_0 = _this__u8e3s4.length - 1 | 0;
      if (inductionVariable_0 <= last_0)
        do {
          var index_0 = inductionVariable_0;
          inductionVariable_0 = inductionVariable_0 + 1 | 0;
          if (equals(element, _this__u8e3s4[index_0])) {
            return index_0;
          }
        }
         while (inductionVariable_0 <= last_0);
    }
    return -1;
  }
  function get_lastIndex(_this__u8e3s4) {
    return _this__u8e3s4.length - 1 | 0;
  }
  function joinToString(_this__u8e3s4, separator, prefix, postfix, limit, truncated, transform) {
    separator = separator === VOID ? ', ' : separator;
    prefix = prefix === VOID ? '' : prefix;
    postfix = postfix === VOID ? '' : postfix;
    limit = limit === VOID ? -1 : limit;
    truncated = truncated === VOID ? '...' : truncated;
    transform = transform === VOID ? null : transform;
    return joinTo(_this__u8e3s4, StringBuilder_init_$Create$_0(), separator, prefix, postfix, limit, truncated, transform).toString();
  }
  function joinTo(_this__u8e3s4, buffer, separator, prefix, postfix, limit, truncated, transform) {
    separator = separator === VOID ? ', ' : separator;
    prefix = prefix === VOID ? '' : prefix;
    postfix = postfix === VOID ? '' : postfix;
    limit = limit === VOID ? -1 : limit;
    truncated = truncated === VOID ? '...' : truncated;
    transform = transform === VOID ? null : transform;
    buffer.append_jgojdo_k$(prefix);
    var count = 0;
    var inductionVariable = 0;
    var last = _this__u8e3s4.length;
    $l$loop: while (inductionVariable < last) {
      var element = _this__u8e3s4[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      count = count + 1 | 0;
      if (count > 1) {
        buffer.append_jgojdo_k$(separator);
      }
      if (limit < 0 || count <= limit) {
        appendElement(buffer, element, transform);
      } else
        break $l$loop;
    }
    if (limit >= 0 && count > limit) {
      buffer.append_jgojdo_k$(truncated);
    }
    buffer.append_jgojdo_k$(postfix);
    return buffer;
  }
  function lastOrNull(_this__u8e3s4) {
    var tmp;
    // Inline function 'kotlin.collections.isEmpty' call
    if (_this__u8e3s4.length === 0) {
      tmp = null;
    } else {
      tmp = _this__u8e3s4[_this__u8e3s4.length - 1 | 0];
    }
    return tmp;
  }
  function toList(_this__u8e3s4) {
    var tmp;
    switch (_this__u8e3s4.length) {
      case 0:
        tmp = emptyList();
        break;
      case 1:
        tmp = listOf(_this__u8e3s4[0]);
        break;
      default:
        // Inline function 'kotlin.collections.copyOf' call

        // Inline function 'kotlin.collections.copyOf' call

        // Inline function 'kotlin.js.asDynamic' call

        var tmp$ret$0 = _this__u8e3s4.slice();
        tmp = asList(tmp$ret$0);
        break;
    }
    return tmp;
  }
  function toSet(_this__u8e3s4) {
    switch (_this__u8e3s4.length) {
      case 0:
        return emptySet();
      case 1:
        return setOf(_this__u8e3s4[0]);
      default:
        return toCollection(_this__u8e3s4, LinkedHashSet_init_$Create$_1(mapCapacity(_this__u8e3s4.length)));
    }
  }
  function filterNotNull(_this__u8e3s4) {
    return filterNotNullTo(_this__u8e3s4, ArrayList_init_$Create$());
  }
  function contains(_this__u8e3s4, element) {
    return indexOf_0(_this__u8e3s4, element) >= 0;
  }
  function single(_this__u8e3s4) {
    var tmp;
    switch (_this__u8e3s4.length) {
      case 0:
        throw NoSuchElementException_init_$Create$_0('Array is empty.');
      case 1:
        tmp = _this__u8e3s4[0];
        break;
      default:
        throw IllegalArgumentException_init_$Create$_0('Array has more than one element.');
    }
    return tmp;
  }
  function toCollection(_this__u8e3s4, destination) {
    var inductionVariable = 0;
    var last = _this__u8e3s4.length;
    while (inductionVariable < last) {
      var item = _this__u8e3s4[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      destination.add_utx5q5_k$(item);
    }
    return destination;
  }
  function filterNotNullTo(_this__u8e3s4, destination) {
    var inductionVariable = 0;
    var last = _this__u8e3s4.length;
    while (inductionVariable < last) {
      var element = _this__u8e3s4[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      if (!(element == null)) {
        destination.add_utx5q5_k$(element);
      }
    }
    return destination;
  }
  function indexOf_0(_this__u8e3s4, element) {
    var inductionVariable = 0;
    var last = _this__u8e3s4.length - 1 | 0;
    if (inductionVariable <= last)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        if (element === _this__u8e3s4[index]) {
          return index;
        }
      }
       while (inductionVariable <= last);
    return -1;
  }
  function getOrNull(_this__u8e3s4, index) {
    return (0 <= index ? index <= (_this__u8e3s4.length - 1 | 0) : false) ? _this__u8e3s4[index] : null;
  }
  function joinToString_0(_this__u8e3s4, separator, prefix, postfix, limit, truncated, transform) {
    separator = separator === VOID ? ', ' : separator;
    prefix = prefix === VOID ? '' : prefix;
    postfix = postfix === VOID ? '' : postfix;
    limit = limit === VOID ? -1 : limit;
    truncated = truncated === VOID ? '...' : truncated;
    transform = transform === VOID ? null : transform;
    return joinTo_0(_this__u8e3s4, StringBuilder_init_$Create$_0(), separator, prefix, postfix, limit, truncated, transform).toString();
  }
  function joinTo_0(_this__u8e3s4, buffer, separator, prefix, postfix, limit, truncated, transform) {
    separator = separator === VOID ? ', ' : separator;
    prefix = prefix === VOID ? '' : prefix;
    postfix = postfix === VOID ? '' : postfix;
    limit = limit === VOID ? -1 : limit;
    truncated = truncated === VOID ? '...' : truncated;
    transform = transform === VOID ? null : transform;
    buffer.append_jgojdo_k$(prefix);
    var count = 0;
    var _iterator__ex2g4s = _this__u8e3s4.iterator_jk1svi_k$();
    $l$loop: while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      count = count + 1 | 0;
      if (count > 1) {
        buffer.append_jgojdo_k$(separator);
      }
      if (limit < 0 || count <= limit) {
        appendElement(buffer, element, transform);
      } else
        break $l$loop;
    }
    if (limit >= 0 && count > limit) {
      buffer.append_jgojdo_k$(truncated);
    }
    buffer.append_jgojdo_k$(postfix);
    return buffer;
  }
  function getOrNull_0(_this__u8e3s4, index) {
    return (0 <= index ? index < _this__u8e3s4.get_size_woubt6_k$() : false) ? _this__u8e3s4.get_c1px32_k$(index) : null;
  }
  function contains_0(_this__u8e3s4, element) {
    if (isInterface(_this__u8e3s4, Collection))
      return _this__u8e3s4.contains_aljjnj_k$(element);
    return indexOf_1(_this__u8e3s4, element) >= 0;
  }
  function toMutableList(_this__u8e3s4) {
    return ArrayList_init_$Create$_1(_this__u8e3s4);
  }
  function take(_this__u8e3s4, n) {
    // Inline function 'kotlin.require' call
    if (!(n >= 0)) {
      var message = 'Requested element count ' + n + ' is less than zero.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    if (n === 0)
      return emptyList();
    if (isInterface(_this__u8e3s4, Collection)) {
      if (n >= _this__u8e3s4.get_size_woubt6_k$())
        return toList_0(_this__u8e3s4);
      if (n === 1)
        return listOf(first(_this__u8e3s4));
    }
    var count = 0;
    var list = ArrayList_init_$Create$_0(n);
    var _iterator__ex2g4s = _this__u8e3s4.iterator_jk1svi_k$();
    $l$loop: while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      list.add_utx5q5_k$(item);
      count = count + 1 | 0;
      if (count === n)
        break $l$loop;
    }
    return optimizeReadOnlyList(list);
  }
  function drop(_this__u8e3s4, n) {
    // Inline function 'kotlin.require' call
    if (!(n >= 0)) {
      var message = 'Requested element count ' + n + ' is less than zero.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    if (n === 0)
      return toList_0(_this__u8e3s4);
    var list;
    if (isInterface(_this__u8e3s4, Collection)) {
      var resultSize = _this__u8e3s4.get_size_woubt6_k$() - n | 0;
      if (resultSize <= 0)
        return emptyList();
      if (resultSize === 1)
        return listOf(last_0(_this__u8e3s4));
      list = ArrayList_init_$Create$_0(resultSize);
      if (isInterface(_this__u8e3s4, KtList)) {
        if (isInterface(_this__u8e3s4, RandomAccess)) {
          var inductionVariable = n;
          var last = _this__u8e3s4.get_size_woubt6_k$();
          if (inductionVariable < last)
            do {
              var index = inductionVariable;
              inductionVariable = inductionVariable + 1 | 0;
              list.add_utx5q5_k$(_this__u8e3s4.get_c1px32_k$(index));
            }
             while (inductionVariable < last);
        } else {
          // Inline function 'kotlin.collections.iterator' call
          var _iterator__ex2g4s = _this__u8e3s4.listIterator_70e65o_k$(n);
          while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
            var item = _iterator__ex2g4s.next_20eer_k$();
            list.add_utx5q5_k$(item);
          }
        }
        return list;
      }
    } else {
      list = ArrayList_init_$Create$();
    }
    var count = 0;
    var _iterator__ex2g4s_0 = _this__u8e3s4.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var item_0 = _iterator__ex2g4s_0.next_20eer_k$();
      if (count >= n)
        list.add_utx5q5_k$(item_0);
      else {
        count = count + 1 | 0;
      }
    }
    return optimizeReadOnlyList(list);
  }
  function sortedWith(_this__u8e3s4, comparator) {
    if (isInterface(_this__u8e3s4, Collection)) {
      if (_this__u8e3s4.get_size_woubt6_k$() <= 1)
        return toList_0(_this__u8e3s4);
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp = copyToArray(_this__u8e3s4);
      // Inline function 'kotlin.apply' call
      var this_0 = isArray(tmp) ? tmp : THROW_CCE();
      sortWith(this_0, comparator);
      return asList(this_0);
    }
    // Inline function 'kotlin.apply' call
    var this_1 = toMutableList_0(_this__u8e3s4);
    sortWith_0(this_1, comparator);
    return this_1;
  }
  function minOrNull(_this__u8e3s4) {
    var iterator = _this__u8e3s4.iterator_jk1svi_k$();
    if (!iterator.hasNext_bitz1p_k$())
      return null;
    var min = iterator.next_20eer_k$();
    while (iterator.hasNext_bitz1p_k$()) {
      var e = iterator.next_20eer_k$();
      // Inline function 'kotlin.comparisons.minOf' call
      var a = min;
      min = Math.min(a, e);
    }
    return min;
  }
  function maxOrNull(_this__u8e3s4) {
    var iterator = _this__u8e3s4.iterator_jk1svi_k$();
    if (!iterator.hasNext_bitz1p_k$())
      return null;
    var max = iterator.next_20eer_k$();
    while (iterator.hasNext_bitz1p_k$()) {
      var e = iterator.next_20eer_k$();
      // Inline function 'kotlin.comparisons.maxOf' call
      var a = max;
      max = Math.max(a, e);
    }
    return max;
  }
  function minOrNull_0(_this__u8e3s4) {
    var iterator = _this__u8e3s4.iterator_jk1svi_k$();
    if (!iterator.hasNext_bitz1p_k$())
      return null;
    var min = iterator.next_20eer_k$();
    while (iterator.hasNext_bitz1p_k$()) {
      var e = iterator.next_20eer_k$();
      if (compareTo(min, e) > 0)
        min = e;
    }
    return min;
  }
  function plus(_this__u8e3s4, elements) {
    if (isInterface(elements, Collection)) {
      var result = ArrayList_init_$Create$_0(_this__u8e3s4.get_size_woubt6_k$() + elements.get_size_woubt6_k$() | 0);
      result.addAll_h3ej1q_k$(_this__u8e3s4);
      result.addAll_h3ej1q_k$(elements);
      return result;
    } else {
      var result_0 = ArrayList_init_$Create$_1(_this__u8e3s4);
      addAll(result_0, elements);
      return result_0;
    }
  }
  function toList_0(_this__u8e3s4) {
    if (isInterface(_this__u8e3s4, Collection)) {
      var tmp;
      switch (_this__u8e3s4.get_size_woubt6_k$()) {
        case 0:
          tmp = emptyList();
          break;
        case 1:
          var tmp_0;
          if (isInterface(_this__u8e3s4, KtList)) {
            tmp_0 = _this__u8e3s4.get_c1px32_k$(0);
          } else {
            tmp_0 = _this__u8e3s4.iterator_jk1svi_k$().next_20eer_k$();
          }

          tmp = listOf(tmp_0);
          break;
        default:
          tmp = toMutableList(_this__u8e3s4);
          break;
      }
      return tmp;
    }
    return optimizeReadOnlyList(toMutableList_0(_this__u8e3s4));
  }
  function singleOrNull(_this__u8e3s4) {
    return _this__u8e3s4.get_size_woubt6_k$() === 1 ? _this__u8e3s4.get_c1px32_k$(0) : null;
  }
  function firstOrNull(_this__u8e3s4) {
    return _this__u8e3s4.isEmpty_y1axqb_k$() ? null : _this__u8e3s4.get_c1px32_k$(0);
  }
  function indexOf_1(_this__u8e3s4, element) {
    if (isInterface(_this__u8e3s4, KtList))
      return _this__u8e3s4.indexOf_si1fv9_k$(element);
    var index = 0;
    var _iterator__ex2g4s = _this__u8e3s4.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      checkIndexOverflow(index);
      if (equals(element, item))
        return index;
      index = index + 1 | 0;
    }
    return -1;
  }
  function toSet_0(_this__u8e3s4) {
    if (isInterface(_this__u8e3s4, Collection)) {
      var tmp;
      switch (_this__u8e3s4.get_size_woubt6_k$()) {
        case 0:
          tmp = emptySet();
          break;
        case 1:
          var tmp_0;
          if (isInterface(_this__u8e3s4, KtList)) {
            tmp_0 = _this__u8e3s4.get_c1px32_k$(0);
          } else {
            tmp_0 = _this__u8e3s4.iterator_jk1svi_k$().next_20eer_k$();
          }

          tmp = setOf(tmp_0);
          break;
        default:
          tmp = toCollection_0(_this__u8e3s4, LinkedHashSet_init_$Create$_1(mapCapacity(_this__u8e3s4.get_size_woubt6_k$())));
          break;
      }
      return tmp;
    }
    return optimizeReadOnlySet(toCollection_0(_this__u8e3s4, LinkedHashSet_init_$Create$()));
  }
  function distinct(_this__u8e3s4) {
    return toList_0(toMutableSet(_this__u8e3s4));
  }
  function toMutableSet(_this__u8e3s4) {
    var tmp;
    if (isInterface(_this__u8e3s4, Collection)) {
      tmp = LinkedHashSet_init_$Create$_0(_this__u8e3s4);
    } else {
      tmp = toCollection_0(_this__u8e3s4, LinkedHashSet_init_$Create$());
    }
    return tmp;
  }
  function last(_this__u8e3s4) {
    if (_this__u8e3s4.isEmpty_y1axqb_k$())
      throw NoSuchElementException_init_$Create$_0('List is empty.');
    return _this__u8e3s4.get_c1px32_k$(get_lastIndex_0(_this__u8e3s4));
  }
  function first(_this__u8e3s4) {
    if (isInterface(_this__u8e3s4, KtList))
      return first_0(_this__u8e3s4);
    else {
      var iterator = _this__u8e3s4.iterator_jk1svi_k$();
      if (!iterator.hasNext_bitz1p_k$())
        throw NoSuchElementException_init_$Create$_0('Collection is empty.');
      return iterator.next_20eer_k$();
    }
  }
  function last_0(_this__u8e3s4) {
    if (isInterface(_this__u8e3s4, KtList))
      return last(_this__u8e3s4);
    else {
      var iterator = _this__u8e3s4.iterator_jk1svi_k$();
      if (!iterator.hasNext_bitz1p_k$())
        throw NoSuchElementException_init_$Create$_0('Collection is empty.');
      var last_0 = iterator.next_20eer_k$();
      while (iterator.hasNext_bitz1p_k$())
        last_0 = iterator.next_20eer_k$();
      return last_0;
    }
  }
  function toMutableList_0(_this__u8e3s4) {
    if (isInterface(_this__u8e3s4, Collection))
      return toMutableList(_this__u8e3s4);
    return toCollection_0(_this__u8e3s4, ArrayList_init_$Create$());
  }
  function toCollection_0(_this__u8e3s4, destination) {
    var _iterator__ex2g4s = _this__u8e3s4.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      destination.add_utx5q5_k$(item);
    }
    return destination;
  }
  function first_0(_this__u8e3s4) {
    if (_this__u8e3s4.isEmpty_y1axqb_k$())
      throw NoSuchElementException_init_$Create$_0('List is empty.');
    return _this__u8e3s4.get_c1px32_k$(0);
  }
  function single_0(_this__u8e3s4) {
    if (isInterface(_this__u8e3s4, KtList))
      return single_1(_this__u8e3s4);
    else {
      var iterator = _this__u8e3s4.iterator_jk1svi_k$();
      if (!iterator.hasNext_bitz1p_k$())
        throw NoSuchElementException_init_$Create$_0('Collection is empty.');
      var single = iterator.next_20eer_k$();
      if (iterator.hasNext_bitz1p_k$())
        throw IllegalArgumentException_init_$Create$_0('Collection has more than one element.');
      return single;
    }
  }
  function single_1(_this__u8e3s4) {
    var tmp;
    switch (_this__u8e3s4.get_size_woubt6_k$()) {
      case 0:
        throw NoSuchElementException_init_$Create$_0('List is empty.');
      case 1:
        tmp = _this__u8e3s4.get_c1px32_k$(0);
        break;
      default:
        throw IllegalArgumentException_init_$Create$_0('List has more than one element.');
    }
    return tmp;
  }
  function toList_1(_this__u8e3s4) {
    if (_this__u8e3s4.get_size_woubt6_k$() === 0)
      return emptyList();
    var iterator = _this__u8e3s4.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    if (!iterator.hasNext_bitz1p_k$())
      return emptyList();
    var first = iterator.next_20eer_k$();
    if (!iterator.hasNext_bitz1p_k$()) {
      // Inline function 'kotlin.collections.toPair' call
      var tmp$ret$0 = new Pair(first.get_key_18j28a_k$(), first.get_value_j01efc_k$());
      return listOf(tmp$ret$0);
    }
    var result = ArrayList_init_$Create$_0(_this__u8e3s4.get_size_woubt6_k$());
    // Inline function 'kotlin.collections.toPair' call
    var tmp$ret$1 = new Pair(first.get_key_18j28a_k$(), first.get_value_j01efc_k$());
    result.add_utx5q5_k$(tmp$ret$1);
    do {
      // Inline function 'kotlin.collections.toPair' call
      var this_0 = iterator.next_20eer_k$();
      var tmp$ret$2 = new Pair(this_0.get_key_18j28a_k$(), this_0.get_value_j01efc_k$());
      result.add_utx5q5_k$(tmp$ret$2);
    }
     while (iterator.hasNext_bitz1p_k$());
    return result;
  }
  function until(_this__u8e3s4, to) {
    if (to <= -2147483648)
      return Companion_getInstance_8().EMPTY_1;
    return numberRangeToNumber(_this__u8e3s4, to - 1 | 0);
  }
  function downTo(_this__u8e3s4, to) {
    return Companion_instance_10.fromClosedRange_y6bqsv_k$(_this__u8e3s4, to, -1);
  }
  function coerceAtMost(_this__u8e3s4, maximumValue) {
    return _this__u8e3s4 > maximumValue ? maximumValue : _this__u8e3s4;
  }
  function coerceAtLeast(_this__u8e3s4, minimumValue) {
    return _this__u8e3s4 < minimumValue ? minimumValue : _this__u8e3s4;
  }
  function coerceIn(_this__u8e3s4, minimumValue, maximumValue) {
    if (minimumValue > maximumValue)
      throw IllegalArgumentException_init_$Create$_0('Cannot coerce value to an empty range: maximum ' + maximumValue + ' is less than minimum ' + minimumValue + '.');
    if (_this__u8e3s4 < minimumValue)
      return minimumValue;
    if (_this__u8e3s4 > maximumValue)
      return maximumValue;
    return _this__u8e3s4;
  }
  function coerceAtMost_0(_this__u8e3s4, maximumValue) {
    return _this__u8e3s4 > maximumValue ? maximumValue : _this__u8e3s4;
  }
  function coerceAtLeast_0(_this__u8e3s4, minimumValue) {
    return _this__u8e3s4 < minimumValue ? minimumValue : _this__u8e3s4;
  }
  function coerceIn_0(_this__u8e3s4, minimumValue, maximumValue) {
    if (minimumValue > maximumValue)
      throw IllegalArgumentException_init_$Create$_0('Cannot coerce value to an empty range: maximum ' + maximumValue + ' is less than minimum ' + minimumValue + '.');
    if (_this__u8e3s4 < minimumValue)
      return minimumValue;
    if (_this__u8e3s4 > maximumValue)
      return maximumValue;
    return _this__u8e3s4;
  }
  function asIterable(_this__u8e3s4) {
    // Inline function 'kotlin.collections.Iterable' call
    return new asIterable$$inlined$Iterable$1(_this__u8e3s4);
  }
  function toList_2(_this__u8e3s4) {
    var it = _this__u8e3s4.iterator_jk1svi_k$();
    if (!it.hasNext_bitz1p_k$())
      return emptyList();
    var element = it.next_20eer_k$();
    if (!it.hasNext_bitz1p_k$())
      return listOf(element);
    var dst = ArrayList_init_$Create$();
    dst.add_utx5q5_k$(element);
    while (it.hasNext_bitz1p_k$()) {
      dst.add_utx5q5_k$(it.next_20eer_k$());
    }
    return dst;
  }
  function asIterable$$inlined$Iterable$1($this_asIterable) {
    this.$this_asIterable_1 = $this_asIterable;
  }
  protoOf(asIterable$$inlined$Iterable$1).iterator_jk1svi_k$ = function () {
    return this.$this_asIterable_1.iterator_jk1svi_k$();
  };
  function plus_0(_this__u8e3s4, elements) {
    var tmp0_safe_receiver = collectionSizeOrNull(elements);
    var tmp;
    if (tmp0_safe_receiver == null) {
      tmp = null;
    } else {
      // Inline function 'kotlin.let' call
      tmp = _this__u8e3s4.get_size_woubt6_k$() + tmp0_safe_receiver | 0;
    }
    var tmp1_elvis_lhs = tmp;
    var result = LinkedHashSet_init_$Create$_1(mapCapacity(tmp1_elvis_lhs == null ? imul(_this__u8e3s4.get_size_woubt6_k$(), 2) : tmp1_elvis_lhs));
    result.addAll_h3ej1q_k$(_this__u8e3s4);
    addAll(result, elements);
    return result;
  }
  function firstOrNull_0(_this__u8e3s4) {
    var tmp;
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(_this__u8e3s4) === 0) {
      tmp = null;
    } else {
      tmp = charSequenceGet(_this__u8e3s4, 0);
    }
    return tmp;
  }
  function drop_0(_this__u8e3s4, n) {
    // Inline function 'kotlin.require' call
    if (!(n >= 0)) {
      var message = 'Requested character count ' + n + ' is less than zero.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    return substring_0(_this__u8e3s4, coerceAtMost(n, _this__u8e3s4.length));
  }
  function getOrNull_1(_this__u8e3s4, index) {
    return (0 <= index ? index <= (charSequenceLength(_this__u8e3s4) - 1 | 0) : false) ? charSequenceGet(_this__u8e3s4, index) : null;
  }
  function dropLast(_this__u8e3s4, n) {
    // Inline function 'kotlin.require' call
    if (!(n >= 0)) {
      var message = 'Requested character count ' + n + ' is less than zero.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    return take_0(_this__u8e3s4, coerceAtLeast(_this__u8e3s4.length - n | 0, 0));
  }
  function take_0(_this__u8e3s4, n) {
    // Inline function 'kotlin.require' call
    if (!(n >= 0)) {
      var message = 'Requested character count ' + n + ' is less than zero.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    return substring(_this__u8e3s4, 0, coerceAtMost(n, _this__u8e3s4.length));
  }
  function withIndex(_this__u8e3s4) {
    return new IndexingIterable(withIndex$lambda(_this__u8e3s4));
  }
  function withIndex$lambda($this_withIndex) {
    return function () {
      return iterator($this_withIndex);
    };
  }
  function _Char___init__impl__6a9atx(value) {
    return value;
  }
  function _get_value__a43j40($this) {
    return $this;
  }
  function _Char___init__impl__6a9atx_0(code) {
    // Inline function 'kotlin.UShort.toInt' call
    var tmp$ret$0 = _UShort___get_data__impl__g0245(code) & 65535;
    return _Char___init__impl__6a9atx(tmp$ret$0);
  }
  function Char__compareTo_impl_ypi4mb($this, other) {
    return _get_value__a43j40($this) - _get_value__a43j40(other) | 0;
  }
  function Char__compareTo_impl_ypi4mb_0($this, other) {
    return Char__compareTo_impl_ypi4mb($this.value_1, other instanceof Char ? other.value_1 : THROW_CCE());
  }
  function Char__plus_impl_qi7pgj($this, other) {
    return numberToChar(_get_value__a43j40($this) + other | 0);
  }
  function Char__minus_impl_a2frrh($this, other) {
    return _get_value__a43j40($this) - _get_value__a43j40(other) | 0;
  }
  function Char__rangeTo_impl_tkncvp($this, other) {
    return new CharRange($this, other);
  }
  function Char__toInt_impl_vasixd($this) {
    return _get_value__a43j40($this);
  }
  function toString($this) {
    // Inline function 'kotlin.js.unsafeCast' call
    return String.fromCharCode(_get_value__a43j40($this));
  }
  function Char__equals_impl_x6719k($this, other) {
    if (!(other instanceof Char))
      return false;
    return _get_value__a43j40($this) === _get_value__a43j40(other.value_1);
  }
  function Char__hashCode_impl_otmys($this) {
    return _get_value__a43j40($this);
  }
  function Companion() {
    Companion_instance = this;
    this.MIN_VALUE_1 = _Char___init__impl__6a9atx(0);
    this.MAX_VALUE_1 = _Char___init__impl__6a9atx(65535);
    this.MIN_HIGH_SURROGATE_1 = _Char___init__impl__6a9atx(55296);
    this.MAX_HIGH_SURROGATE_1 = _Char___init__impl__6a9atx(56319);
    this.MIN_LOW_SURROGATE_1 = _Char___init__impl__6a9atx(56320);
    this.MAX_LOW_SURROGATE_1 = _Char___init__impl__6a9atx(57343);
    this.MIN_SURROGATE_1 = _Char___init__impl__6a9atx(55296);
    this.MAX_SURROGATE_1 = _Char___init__impl__6a9atx(57343);
    this.SIZE_BYTES_1 = 2;
    this.SIZE_BITS_1 = 16;
  }
  var Companion_instance;
  function Companion_getInstance() {
    if (Companion_instance == null)
      new Companion();
    return Companion_instance;
  }
  function Char(value) {
    Companion_getInstance();
    this.value_1 = value;
  }
  protoOf(Char).compareTo_t5gg65_k$ = function (other) {
    return Char__compareTo_impl_ypi4mb(this.value_1, other);
  };
  protoOf(Char).compareTo_hpufkf_k$ = function (other) {
    return Char__compareTo_impl_ypi4mb_0(this, other);
  };
  protoOf(Char).toString = function () {
    return toString(this.value_1);
  };
  protoOf(Char).equals = function (other) {
    return Char__equals_impl_x6719k(this.value_1, other);
  };
  protoOf(Char).hashCode = function () {
    return Char__hashCode_impl_otmys(this.value_1);
  };
  function Collection() {
  }
  function KtSet() {
  }
  function KtList() {
  }
  function Entry() {
  }
  function KtMap() {
  }
  function KtMutableMap() {
  }
  function Companion_0() {
  }
  var Companion_instance_0;
  function Companion_getInstance_0() {
    return Companion_instance_0;
  }
  function Enum(name, ordinal) {
    this.name_1 = name;
    this.ordinal_1 = ordinal;
  }
  protoOf(Enum).compareTo_30rs7w_k$ = function (other) {
    return compareTo(this.ordinal_1, other.ordinal_1);
  };
  protoOf(Enum).compareTo_hpufkf_k$ = function (other) {
    return this.compareTo_30rs7w_k$(other instanceof Enum ? other : THROW_CCE());
  };
  protoOf(Enum).equals = function (other) {
    return this === other;
  };
  protoOf(Enum).hashCode = function () {
    return identityHashCode(this);
  };
  protoOf(Enum).toString = function () {
    return this.name_1;
  };
  function toString_0(_this__u8e3s4) {
    var tmp1_elvis_lhs = _this__u8e3s4 == null ? null : toString_1(_this__u8e3s4);
    return tmp1_elvis_lhs == null ? 'null' : tmp1_elvis_lhs;
  }
  function Companion_1() {
    Companion_instance_1 = this;
    this.MIN_VALUE_1 = new Long(0, -2147483648);
    this.MAX_VALUE_1 = new Long(-1, 2147483647);
    this.SIZE_BYTES_1 = 8;
    this.SIZE_BITS_1 = 64;
  }
  var Companion_instance_1;
  function Companion_getInstance_1() {
    if (Companion_instance_1 == null)
      new Companion_1();
    return Companion_instance_1;
  }
  function Long(low, high) {
    Companion_getInstance_1();
    Number_0.call(this);
    this.low_1 = low;
    this.high_1 = high;
  }
  protoOf(Long).compareTo_222nlo_k$ = function (other) {
    return compare(this, other);
  };
  protoOf(Long).compareTo_hpufkf_k$ = function (other) {
    return this.compareTo_222nlo_k$(other instanceof Long ? other : THROW_CCE());
  };
  protoOf(Long).toString = function () {
    return toStringImpl(this, 10);
  };
  protoOf(Long).equals = function (other) {
    var tmp;
    if (other instanceof Long) {
      tmp = equalsLong(this, other);
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(Long).hashCode = function () {
    return hashCode(this);
  };
  protoOf(Long).valueOf = function () {
    return toNumber(this);
  };
  function abs(_this__u8e3s4) {
    var tmp;
    // Inline function 'kotlin.js.internal.isNegative' call
    if (_this__u8e3s4 < 0) {
      // Inline function 'kotlin.js.internal.unaryMinus' call
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      tmp = -_this__u8e3s4;
    } else {
      tmp = _this__u8e3s4;
    }
    return tmp;
  }
  function FunctionAdapter() {
  }
  function charArrayOf(arr) {
    var tmp0 = 'CharArray';
    // Inline function 'withType' call
    var array = new Uint16Array(arr);
    array.$type$ = tmp0;
    // Inline function 'kotlin.js.unsafeCast' call
    return array;
  }
  function get_buf() {
    _init_properties_bitUtils_kt__nfcg4k();
    return buf;
  }
  var buf;
  function get_bufFloat64() {
    _init_properties_bitUtils_kt__nfcg4k();
    return bufFloat64;
  }
  var bufFloat64;
  var bufFloat32;
  function get_bufInt32() {
    _init_properties_bitUtils_kt__nfcg4k();
    return bufInt32;
  }
  var bufInt32;
  function get_lowIndex() {
    _init_properties_bitUtils_kt__nfcg4k();
    return lowIndex;
  }
  var lowIndex;
  function get_highIndex() {
    _init_properties_bitUtils_kt__nfcg4k();
    return highIndex;
  }
  var highIndex;
  function getNumberHashCode(obj) {
    _init_properties_bitUtils_kt__nfcg4k();
    // Inline function 'kotlin.js.jsBitwiseOr' call
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.js.asDynamic' call
    if ((obj | 0) === obj) {
      return numberToInt(obj);
    }
    get_bufFloat64()[0] = obj;
    return imul(get_bufInt32()[get_highIndex()], 31) + get_bufInt32()[get_lowIndex()] | 0;
  }
  var properties_initialized_bitUtils_kt_i2bo3e;
  function _init_properties_bitUtils_kt__nfcg4k() {
    if (!properties_initialized_bitUtils_kt_i2bo3e) {
      properties_initialized_bitUtils_kt_i2bo3e = true;
      buf = new ArrayBuffer(8);
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      bufFloat64 = new Float64Array(get_buf());
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      bufFloat32 = new Float32Array(get_buf());
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      bufInt32 = new Int32Array(get_buf());
      // Inline function 'kotlin.run' call
      get_bufFloat64()[0] = -1.0;
      lowIndex = !(get_bufInt32()[0] === 0) ? 1 : 0;
      highIndex = 1 - get_lowIndex() | 0;
    }
  }
  function get_ZERO() {
    _init_properties_boxedLong_kt__v24qrw();
    return ZERO;
  }
  var ZERO;
  function get_ONE() {
    _init_properties_boxedLong_kt__v24qrw();
    return ONE;
  }
  var ONE;
  function get_NEG_ONE() {
    _init_properties_boxedLong_kt__v24qrw();
    return NEG_ONE;
  }
  var NEG_ONE;
  function get_MAX_VALUE() {
    _init_properties_boxedLong_kt__v24qrw();
    return MAX_VALUE;
  }
  var MAX_VALUE;
  function get_MIN_VALUE() {
    _init_properties_boxedLong_kt__v24qrw();
    return MIN_VALUE;
  }
  var MIN_VALUE;
  function get_TWO_PWR_24_() {
    _init_properties_boxedLong_kt__v24qrw();
    return TWO_PWR_24_;
  }
  var TWO_PWR_24_;
  var longArrayClass;
  function compare(_this__u8e3s4, other) {
    _init_properties_boxedLong_kt__v24qrw();
    if (equalsLong(_this__u8e3s4, other)) {
      return 0;
    }
    var thisNeg = isNegative(_this__u8e3s4);
    var otherNeg = isNegative(other);
    return thisNeg && !otherNeg ? -1 : !thisNeg && otherNeg ? 1 : isNegative(subtract(_this__u8e3s4, other)) ? -1 : 1;
  }
  function convertToInt(_this__u8e3s4) {
    _init_properties_boxedLong_kt__v24qrw();
    return _this__u8e3s4.low_1;
  }
  function toNumber(_this__u8e3s4) {
    _init_properties_boxedLong_kt__v24qrw();
    return _this__u8e3s4.high_1 * 4.294967296E9 + getLowBitsUnsigned(_this__u8e3s4);
  }
  function toStringImpl(_this__u8e3s4, radix) {
    _init_properties_boxedLong_kt__v24qrw();
    if (isZero(_this__u8e3s4)) {
      return '0';
    }
    if (isNegative(_this__u8e3s4)) {
      if (equalsLong(_this__u8e3s4, get_MIN_VALUE())) {
        var radixLong = fromInt(radix);
        var div = divide(_this__u8e3s4, radixLong);
        var rem = convertToInt(subtract(multiply(div, radixLong), _this__u8e3s4));
        var tmp = toStringImpl(div, radix);
        // Inline function 'kotlin.js.asDynamic' call
        // Inline function 'kotlin.js.unsafeCast' call
        return tmp + rem.toString(radix);
      } else {
        return '-' + toStringImpl(negate(_this__u8e3s4), radix);
      }
    }
    var digitsPerTime = radix === 2 ? 31 : radix <= 10 ? 9 : radix <= 21 ? 7 : radix <= 35 ? 6 : 5;
    var radixToPower = fromNumber(Math.pow(radix, digitsPerTime));
    var rem_0 = _this__u8e3s4;
    var result = '';
    while (true) {
      var remDiv = divide(rem_0, radixToPower);
      var intval = convertToInt(subtract(rem_0, multiply(remDiv, radixToPower)));
      // Inline function 'kotlin.js.asDynamic' call
      // Inline function 'kotlin.js.unsafeCast' call
      var digits = intval.toString(radix);
      rem_0 = remDiv;
      if (isZero(rem_0)) {
        return digits + result;
      } else {
        while (digits.length < digitsPerTime) {
          digits = '0' + digits;
        }
        result = digits + result;
      }
    }
  }
  function equalsLong(_this__u8e3s4, other) {
    _init_properties_boxedLong_kt__v24qrw();
    return _this__u8e3s4.high_1 === other.high_1 && _this__u8e3s4.low_1 === other.low_1;
  }
  function hashCode(l) {
    _init_properties_boxedLong_kt__v24qrw();
    return l.low_1 ^ l.high_1;
  }
  function fromInt(value) {
    _init_properties_boxedLong_kt__v24qrw();
    return new Long(value, value < 0 ? -1 : 0);
  }
  function isNegative(_this__u8e3s4) {
    _init_properties_boxedLong_kt__v24qrw();
    return _this__u8e3s4.high_1 < 0;
  }
  function subtract(_this__u8e3s4, other) {
    _init_properties_boxedLong_kt__v24qrw();
    return add(_this__u8e3s4, negate(other));
  }
  function getLowBitsUnsigned(_this__u8e3s4) {
    _init_properties_boxedLong_kt__v24qrw();
    return _this__u8e3s4.low_1 >= 0 ? _this__u8e3s4.low_1 : 4.294967296E9 + _this__u8e3s4.low_1;
  }
  function isZero(_this__u8e3s4) {
    _init_properties_boxedLong_kt__v24qrw();
    return _this__u8e3s4.high_1 === 0 && _this__u8e3s4.low_1 === 0;
  }
  function multiply(_this__u8e3s4, other) {
    _init_properties_boxedLong_kt__v24qrw();
    if (isZero(_this__u8e3s4)) {
      return get_ZERO();
    } else if (isZero(other)) {
      return get_ZERO();
    }
    if (equalsLong(_this__u8e3s4, get_MIN_VALUE())) {
      return isOdd(other) ? get_MIN_VALUE() : get_ZERO();
    } else if (equalsLong(other, get_MIN_VALUE())) {
      return isOdd(_this__u8e3s4) ? get_MIN_VALUE() : get_ZERO();
    }
    if (isNegative(_this__u8e3s4)) {
      var tmp;
      if (isNegative(other)) {
        tmp = multiply(negate(_this__u8e3s4), negate(other));
      } else {
        tmp = negate(multiply(negate(_this__u8e3s4), other));
      }
      return tmp;
    } else if (isNegative(other)) {
      return negate(multiply(_this__u8e3s4, negate(other)));
    }
    if (lessThan(_this__u8e3s4, get_TWO_PWR_24_()) && lessThan(other, get_TWO_PWR_24_())) {
      return fromNumber(toNumber(_this__u8e3s4) * toNumber(other));
    }
    var a48 = _this__u8e3s4.high_1 >>> 16 | 0;
    var a32 = _this__u8e3s4.high_1 & 65535;
    var a16 = _this__u8e3s4.low_1 >>> 16 | 0;
    var a00 = _this__u8e3s4.low_1 & 65535;
    var b48 = other.high_1 >>> 16 | 0;
    var b32 = other.high_1 & 65535;
    var b16 = other.low_1 >>> 16 | 0;
    var b00 = other.low_1 & 65535;
    var c48 = 0;
    var c32 = 0;
    var c16 = 0;
    var c00 = 0;
    c00 = c00 + imul(a00, b00) | 0;
    c16 = c16 + (c00 >>> 16 | 0) | 0;
    c00 = c00 & 65535;
    c16 = c16 + imul(a16, b00) | 0;
    c32 = c32 + (c16 >>> 16 | 0) | 0;
    c16 = c16 & 65535;
    c16 = c16 + imul(a00, b16) | 0;
    c32 = c32 + (c16 >>> 16 | 0) | 0;
    c16 = c16 & 65535;
    c32 = c32 + imul(a32, b00) | 0;
    c48 = c48 + (c32 >>> 16 | 0) | 0;
    c32 = c32 & 65535;
    c32 = c32 + imul(a16, b16) | 0;
    c48 = c48 + (c32 >>> 16 | 0) | 0;
    c32 = c32 & 65535;
    c32 = c32 + imul(a00, b32) | 0;
    c48 = c48 + (c32 >>> 16 | 0) | 0;
    c32 = c32 & 65535;
    c48 = c48 + (((imul(a48, b00) + imul(a32, b16) | 0) + imul(a16, b32) | 0) + imul(a00, b48) | 0) | 0;
    c48 = c48 & 65535;
    return new Long(c16 << 16 | c00, c48 << 16 | c32);
  }
  function negate(_this__u8e3s4) {
    _init_properties_boxedLong_kt__v24qrw();
    return add(invert(_this__u8e3s4), new Long(1, 0));
  }
  function fromNumber(value) {
    _init_properties_boxedLong_kt__v24qrw();
    if (isNaN_0(value)) {
      return get_ZERO();
    } else if (value <= -9.223372036854776E18) {
      return get_MIN_VALUE();
    } else if (value + 1 >= 9.223372036854776E18) {
      return get_MAX_VALUE();
    } else if (value < 0) {
      return negate(fromNumber(-value));
    } else {
      var twoPwr32 = 4.294967296E9;
      // Inline function 'kotlin.js.jsBitwiseOr' call
      var tmp = value % twoPwr32 | 0;
      // Inline function 'kotlin.js.jsBitwiseOr' call
      var tmp$ret$1 = value / twoPwr32 | 0;
      return new Long(tmp, tmp$ret$1);
    }
  }
  function add(_this__u8e3s4, other) {
    _init_properties_boxedLong_kt__v24qrw();
    var a48 = _this__u8e3s4.high_1 >>> 16 | 0;
    var a32 = _this__u8e3s4.high_1 & 65535;
    var a16 = _this__u8e3s4.low_1 >>> 16 | 0;
    var a00 = _this__u8e3s4.low_1 & 65535;
    var b48 = other.high_1 >>> 16 | 0;
    var b32 = other.high_1 & 65535;
    var b16 = other.low_1 >>> 16 | 0;
    var b00 = other.low_1 & 65535;
    var c48 = 0;
    var c32 = 0;
    var c16 = 0;
    var c00 = 0;
    c00 = c00 + (a00 + b00 | 0) | 0;
    c16 = c16 + (c00 >>> 16 | 0) | 0;
    c00 = c00 & 65535;
    c16 = c16 + (a16 + b16 | 0) | 0;
    c32 = c32 + (c16 >>> 16 | 0) | 0;
    c16 = c16 & 65535;
    c32 = c32 + (a32 + b32 | 0) | 0;
    c48 = c48 + (c32 >>> 16 | 0) | 0;
    c32 = c32 & 65535;
    c48 = c48 + (a48 + b48 | 0) | 0;
    c48 = c48 & 65535;
    return new Long(c16 << 16 | c00, c48 << 16 | c32);
  }
  function isOdd(_this__u8e3s4) {
    _init_properties_boxedLong_kt__v24qrw();
    return (_this__u8e3s4.low_1 & 1) === 1;
  }
  function lessThan(_this__u8e3s4, other) {
    _init_properties_boxedLong_kt__v24qrw();
    return compare(_this__u8e3s4, other) < 0;
  }
  function invert(_this__u8e3s4) {
    _init_properties_boxedLong_kt__v24qrw();
    return new Long(~_this__u8e3s4.low_1, ~_this__u8e3s4.high_1);
  }
  function divide(_this__u8e3s4, other) {
    _init_properties_boxedLong_kt__v24qrw();
    if (isZero(other)) {
      throw Exception_init_$Create$_0('division by zero');
    } else if (isZero(_this__u8e3s4)) {
      return get_ZERO();
    }
    if (equalsLong(_this__u8e3s4, get_MIN_VALUE())) {
      if (equalsLong(other, get_ONE()) || equalsLong(other, get_NEG_ONE())) {
        return get_MIN_VALUE();
      } else if (equalsLong(other, get_MIN_VALUE())) {
        return get_ONE();
      } else {
        var halfThis = shiftRight(_this__u8e3s4, 1);
        var approx = shiftLeft(divide(halfThis, other), 1);
        if (equalsLong(approx, get_ZERO())) {
          return isNegative(other) ? get_ONE() : get_NEG_ONE();
        } else {
          var rem = subtract(_this__u8e3s4, multiply(other, approx));
          return add(approx, divide(rem, other));
        }
      }
    } else if (equalsLong(other, get_MIN_VALUE())) {
      return get_ZERO();
    }
    if (isNegative(_this__u8e3s4)) {
      var tmp;
      if (isNegative(other)) {
        tmp = divide(negate(_this__u8e3s4), negate(other));
      } else {
        tmp = negate(divide(negate(_this__u8e3s4), other));
      }
      return tmp;
    } else if (isNegative(other)) {
      return negate(divide(_this__u8e3s4, negate(other)));
    }
    var res = get_ZERO();
    var rem_0 = _this__u8e3s4;
    while (greaterThanOrEqual(rem_0, other)) {
      var approxDouble = toNumber(rem_0) / toNumber(other);
      var approx2 = Math.max(1.0, Math.floor(approxDouble));
      var log2 = Math.ceil(Math.log(approx2) / Math.LN2);
      var delta = log2 <= 48 ? 1.0 : Math.pow(2.0, log2 - 48);
      var approxRes = fromNumber(approx2);
      var approxRem = multiply(approxRes, other);
      while (isNegative(approxRem) || greaterThan(approxRem, rem_0)) {
        approx2 = approx2 - delta;
        approxRes = fromNumber(approx2);
        approxRem = multiply(approxRes, other);
      }
      if (isZero(approxRes)) {
        approxRes = get_ONE();
      }
      res = add(res, approxRes);
      rem_0 = subtract(rem_0, approxRem);
    }
    return res;
  }
  function shiftRight(_this__u8e3s4, numBits) {
    _init_properties_boxedLong_kt__v24qrw();
    var numBits_0 = numBits & 63;
    if (numBits_0 === 0) {
      return _this__u8e3s4;
    } else {
      if (numBits_0 < 32) {
        return new Long(_this__u8e3s4.low_1 >>> numBits_0 | 0 | _this__u8e3s4.high_1 << (32 - numBits_0 | 0), _this__u8e3s4.high_1 >> numBits_0);
      } else {
        return new Long(_this__u8e3s4.high_1 >> (numBits_0 - 32 | 0), _this__u8e3s4.high_1 >= 0 ? 0 : -1);
      }
    }
  }
  function shiftLeft(_this__u8e3s4, numBits) {
    _init_properties_boxedLong_kt__v24qrw();
    var numBits_0 = numBits & 63;
    if (numBits_0 === 0) {
      return _this__u8e3s4;
    } else {
      if (numBits_0 < 32) {
        return new Long(_this__u8e3s4.low_1 << numBits_0, _this__u8e3s4.high_1 << numBits_0 | (_this__u8e3s4.low_1 >>> (32 - numBits_0 | 0) | 0));
      } else {
        return new Long(0, _this__u8e3s4.low_1 << (numBits_0 - 32 | 0));
      }
    }
  }
  function greaterThan(_this__u8e3s4, other) {
    _init_properties_boxedLong_kt__v24qrw();
    return compare(_this__u8e3s4, other) > 0;
  }
  function greaterThanOrEqual(_this__u8e3s4, other) {
    _init_properties_boxedLong_kt__v24qrw();
    return compare(_this__u8e3s4, other) >= 0;
  }
  function modulo(_this__u8e3s4, other) {
    _init_properties_boxedLong_kt__v24qrw();
    return subtract(_this__u8e3s4, multiply(divide(_this__u8e3s4, other), other));
  }
  function numberToLong(a) {
    _init_properties_boxedLong_kt__v24qrw();
    var tmp;
    if (a instanceof Long) {
      tmp = a;
    } else {
      tmp = fromNumber(a);
    }
    return tmp;
  }
  function isLongArray(a) {
    _init_properties_boxedLong_kt__v24qrw();
    return isJsArray(a) && a.$type$ === 'LongArray';
  }
  function longArrayClass$lambda(it) {
    _init_properties_boxedLong_kt__v24qrw();
    return !(it == null) ? isLongArray(it) : false;
  }
  var properties_initialized_boxedLong_kt_lfwt2;
  function _init_properties_boxedLong_kt__v24qrw() {
    if (!properties_initialized_boxedLong_kt_lfwt2) {
      properties_initialized_boxedLong_kt_lfwt2 = true;
      ZERO = fromInt(0);
      ONE = fromInt(1);
      NEG_ONE = fromInt(-1);
      MAX_VALUE = new Long(-1, 2147483647);
      MIN_VALUE = new Long(0, -2147483648);
      TWO_PWR_24_ = fromInt(16777216);
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp = Array;
      longArrayClass = new PrimitiveKClassImpl(tmp, 'LongArray', longArrayClass$lambda);
    }
  }
  function charSequenceGet(a, index) {
    var tmp;
    if (isString(a)) {
      tmp = charCodeAt(a, index);
    } else {
      tmp = a.get_kdzpvg_k$(index);
    }
    return tmp;
  }
  function isString(a) {
    return typeof a === 'string';
  }
  function charCodeAt(_this__u8e3s4, index) {
    // Inline function 'kotlin.js.asDynamic' call
    return _this__u8e3s4.charCodeAt(index);
  }
  function charSequenceLength(a) {
    var tmp;
    if (isString(a)) {
      // Inline function 'kotlin.js.asDynamic' call
      // Inline function 'kotlin.js.unsafeCast' call
      tmp = a.length;
    } else {
      tmp = a.get_length_g42xv3_k$();
    }
    return tmp;
  }
  function charSequenceSubSequence(a, startIndex, endIndex) {
    var tmp;
    if (isString(a)) {
      tmp = substring(a, startIndex, endIndex);
    } else {
      tmp = a.subSequence_hm5hnj_k$(startIndex, endIndex);
    }
    return tmp;
  }
  function arrayToString(array) {
    return joinToString(array, ', ', '[', ']', VOID, VOID, arrayToString$lambda);
  }
  function contentEqualsInternal(_this__u8e3s4, other) {
    // Inline function 'kotlin.js.asDynamic' call
    var a = _this__u8e3s4;
    // Inline function 'kotlin.js.asDynamic' call
    var b = other;
    if (a === b)
      return true;
    if (a == null || b == null || !isArrayish(b) || a.length != b.length)
      return false;
    var inductionVariable = 0;
    var last = a.length;
    if (inductionVariable < last)
      do {
        var i = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        if (!equals(a[i], b[i])) {
          return false;
        }
      }
       while (inductionVariable < last);
    return true;
  }
  function contentHashCodeInternal(_this__u8e3s4) {
    // Inline function 'kotlin.js.asDynamic' call
    var a = _this__u8e3s4;
    if (a == null)
      return 0;
    var result = 1;
    var inductionVariable = 0;
    var last = a.length;
    if (inductionVariable < last)
      do {
        var i = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        result = imul(result, 31) + hashCode_0(a[i]) | 0;
      }
       while (inductionVariable < last);
    return result;
  }
  function arrayToString$lambda(it) {
    return toString_1(it);
  }
  function compareTo(a, b) {
    var tmp;
    switch (typeof a) {
      case 'number':
        var tmp_0;
        if (typeof b === 'number') {
          tmp_0 = doubleCompareTo(a, b);
        } else {
          if (b instanceof Long) {
            tmp_0 = doubleCompareTo(a, toNumber(b));
          } else {
            tmp_0 = primitiveCompareTo(a, b);
          }
        }

        tmp = tmp_0;
        break;
      case 'string':
      case 'boolean':
      case 'bigint':
        tmp = primitiveCompareTo(a, b);
        break;
      default:
        tmp = compareToDoNotIntrinsicify(a, b);
        break;
    }
    return tmp;
  }
  function doubleCompareTo(a, b) {
    var tmp;
    if (a < b) {
      tmp = -1;
    } else if (a > b) {
      tmp = 1;
    } else if (a === b) {
      var tmp_0;
      if (a !== 0) {
        tmp_0 = 0;
      } else {
        // Inline function 'kotlin.js.asDynamic' call
        var ia = 1 / a;
        var tmp_1;
        // Inline function 'kotlin.js.asDynamic' call
        if (ia === 1 / b) {
          tmp_1 = 0;
        } else {
          if (ia < 0) {
            tmp_1 = -1;
          } else {
            tmp_1 = 1;
          }
        }
        tmp_0 = tmp_1;
      }
      tmp = tmp_0;
    } else if (a !== a) {
      tmp = b !== b ? 0 : 1;
    } else {
      tmp = -1;
    }
    return tmp;
  }
  function primitiveCompareTo(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function compareToDoNotIntrinsicify(a, b) {
    return a.compareTo_hpufkf_k$(b);
  }
  function identityHashCode(obj) {
    return getObjectHashCode(obj);
  }
  function objectCreate(proto) {
    proto = proto === VOID ? null : proto;
    return Object.create(proto);
  }
  function defineProp(obj, name, getter, setter, enumerable) {
    return Object.defineProperty(obj, name, {configurable: true, get: getter, set: setter, enumerable: enumerable});
  }
  function getObjectHashCode(obj) {
    // Inline function 'kotlin.js.jsIn' call
    if (!('kotlinHashCodeValue$' in obj)) {
      var hash = calculateRandomHash();
      var descriptor = new Object();
      descriptor.value = hash;
      descriptor.enumerable = false;
      Object.defineProperty(obj, 'kotlinHashCodeValue$', descriptor);
    }
    // Inline function 'kotlin.js.unsafeCast' call
    return obj['kotlinHashCodeValue$'];
  }
  function calculateRandomHash() {
    // Inline function 'kotlin.js.jsBitwiseOr' call
    return Math.random() * 4.294967296E9 | 0;
  }
  function toString_1(o) {
    var tmp;
    if (o == null) {
      tmp = 'null';
    } else if (isArrayish(o)) {
      tmp = '[...]';
    } else if (!(typeof o.toString === 'function')) {
      tmp = anyToString(o);
    } else {
      // Inline function 'kotlin.js.unsafeCast' call
      tmp = o.toString();
    }
    return tmp;
  }
  function anyToString(o) {
    return Object.prototype.toString.call(o);
  }
  function equals(obj1, obj2) {
    if (obj1 == null) {
      return obj2 == null;
    }
    if (obj2 == null) {
      return false;
    }
    if (typeof obj1 === 'object' && typeof obj1.equals === 'function') {
      return obj1.equals(obj2);
    }
    if (obj1 !== obj1) {
      return obj2 !== obj2;
    }
    if (typeof obj1 === 'number' && typeof obj2 === 'number') {
      var tmp;
      if (obj1 === obj2) {
        var tmp_0;
        if (obj1 !== 0) {
          tmp_0 = true;
        } else {
          // Inline function 'kotlin.js.asDynamic' call
          var tmp_1 = 1 / obj1;
          // Inline function 'kotlin.js.asDynamic' call
          tmp_0 = tmp_1 === 1 / obj2;
        }
        tmp = tmp_0;
      } else {
        tmp = false;
      }
      return tmp;
    }
    if (isCallableReference(obj1) && isCallableReference(obj2)) {
      if (obj1 === obj2)
        return true;
      if (obj1.$id != obj2.$id)
        return false;
      if (obj1.$flags != obj2.$flags)
        return false;
      if (obj1.$arity != obj2.$arity)
        return false;
      if (obj1.$bound == null && obj2.$bound == null)
        return true;
      if (obj1.$bound === obj2.$bound)
        return true;
      if (!isJsArray(obj1.$bound) || !isJsArray(obj2.$bound))
        return false;
      // Inline function 'kotlin.js.unsafeCast' call
      var bound1 = obj1.$bound;
      // Inline function 'kotlin.js.unsafeCast' call
      var bound2 = obj2.$bound;
      return contentEqualsInternal(bound1, bound2);
    }
    return obj1 === obj2;
  }
  function hashCode_0(obj) {
    if (obj == null)
      return 0;
    var typeOf = typeof obj;
    var tmp;
    switch (typeOf) {
      case 'object':
        tmp = 'function' === typeof obj.hashCode ? obj.hashCode() : getObjectHashCode(obj);
        break;
      case 'function':
        tmp = isCallableReference(obj) ? getCallableReferenceHashCode(obj) : getObjectHashCode(obj);
        break;
      case 'number':
        tmp = getNumberHashCode(obj);
        break;
      case 'boolean':
        // Inline function 'kotlin.js.unsafeCast' call

        tmp = getBooleanHashCode(obj);
        break;
      case 'string':
        tmp = getStringHashCode(String(obj));
        break;
      case 'bigint':
        // Inline function 'kotlin.js.unsafeCast' call

        tmp = getBigIntHashCode(obj);
        break;
      case 'symbol':
        tmp = getSymbolHashCode(obj);
        break;
      default:
        tmp = function () {
          throw new Error('Unexpected typeof `' + typeOf + '`');
        }();
        break;
    }
    return tmp;
  }
  function getCallableReferenceHashCode(obj) {
    // Inline function 'kotlin.js.unsafeCast' call
    var hash = obj.$flags;
    hash = imul(31, hash) + hashCode_0(obj.$id) | 0;
    var tmp = imul(31, hash);
    var tmp0_elvis_lhs = obj.$arity;
    // Inline function 'kotlin.js.unsafeCast' call
    hash = tmp + (tmp0_elvis_lhs == null ? -1 : tmp0_elvis_lhs) | 0;
    var bound = obj.$bound;
    if (bound != null && isJsArray(bound)) {
      // Inline function 'kotlin.js.unsafeCast' call
      var boundArray = bound;
      hash = imul(31, hash) + contentHashCodeInternal(boundArray) | 0;
    }
    return hash;
  }
  function getBooleanHashCode(value) {
    return value ? 1231 : 1237;
  }
  function getStringHashCode(str) {
    var hash = 0;
    var length = str.length;
    var inductionVariable = 0;
    var last = length - 1 | 0;
    if (inductionVariable <= last)
      do {
        var i = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        // Inline function 'kotlin.js.asDynamic' call
        var code = str.charCodeAt(i);
        hash = imul(hash, 31) + code | 0;
      }
       while (!(i === last));
    return hash;
  }
  function getBigIntHashCode(value) {
    var shiftNumber = BigInt(32);
    var mask = BigInt(4.294967295E9);
    var bigNumber = abs(value);
    var hashCode = 0;
    var tmp;
    // Inline function 'kotlin.js.internal.isNegative' call
    if (value < 0) {
      tmp = -1;
    } else {
      tmp = 1;
    }
    var signum = tmp;
    $l$loop: while (true) {
      // Inline function 'kotlin.js.internal.isZero' call
      if (!!(bigNumber == 0)) {
        break $l$loop;
      }
      // Inline function 'kotlin.js.internal.and' call
      // Inline function 'kotlin.js.jsBitwiseAnd' call
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      // Inline function 'kotlin.js.internal.toNumber' call
      var self_0 = bigNumber & mask;
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      var chunk = Number(self_0);
      hashCode = imul(31, hashCode) + chunk | 0;
      // Inline function 'kotlin.js.internal.shr' call
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      bigNumber = bigNumber >> shiftNumber;
    }
    return imul(hashCode, signum);
  }
  function getSymbolHashCode(value) {
    var hashCodeMap = symbolIsSharable(value) ? getSymbolMap() : getSymbolWeakMap();
    var cachedHashCode = hashCodeMap.get(value);
    if (cachedHashCode !== VOID)
      return cachedHashCode;
    var hash = calculateRandomHash();
    hashCodeMap.set(value, hash);
    return hash;
  }
  function symbolIsSharable(symbol) {
    return Symbol.keyFor(symbol) != VOID;
  }
  function getSymbolMap() {
    if (symbolMap === VOID) {
      symbolMap = new Map();
    }
    return symbolMap;
  }
  function getSymbolWeakMap() {
    if (symbolWeakMap === VOID) {
      symbolWeakMap = new WeakMap();
    }
    return symbolWeakMap;
  }
  var symbolMap;
  var symbolWeakMap;
  function boxIntrinsic(x) {
    // Inline function 'kotlin.error' call
    var message = 'Should be lowered';
    throw IllegalStateException_init_$Create$_0(toString_1(message));
  }
  function unboxIntrinsic(x) {
    // Inline function 'kotlin.error' call
    var message = 'Should be lowered';
    throw IllegalStateException_init_$Create$_0(toString_1(message));
  }
  function captureStack(instance, constructorFunction) {
    if (Error.captureStackTrace != null) {
      Error.captureStackTrace(instance, constructorFunction);
    } else {
      // Inline function 'kotlin.js.asDynamic' call
      instance.stack = (new Error()).stack;
    }
  }
  function protoOf(constructor) {
    return constructor.prototype;
  }
  function defineMessage(message, cause) {
    var tmp;
    if (isUndefined(message)) {
      var tmp_0;
      if (isUndefined(cause)) {
        tmp_0 = message;
      } else {
        var tmp1_elvis_lhs = cause == null ? null : cause.toString();
        tmp_0 = tmp1_elvis_lhs == null ? VOID : tmp1_elvis_lhs;
      }
      tmp = tmp_0;
    } else {
      tmp = message == null ? VOID : message;
    }
    return tmp;
  }
  function isUndefined(value) {
    return value === VOID;
  }
  function extendThrowable(this_, message, cause) {
    defineFieldOnInstance(this_, 'message', defineMessage(message, cause));
    defineFieldOnInstance(this_, 'cause', cause);
    defineFieldOnInstance(this_, 'name', Object.getPrototypeOf(this_).constructor.name);
  }
  function defineFieldOnInstance(this_, name, value) {
    Object.defineProperty(this_, name, {configurable: true, writable: true, value: value});
  }
  function noWhenBranchMatchedException() {
    throw NoWhenBranchMatchedException_init_$Create$();
  }
  function THROW_NPE() {
    throw NullPointerException_init_$Create$();
  }
  function THROW_CCE() {
    throw ClassCastException_init_$Create$();
  }
  function THROW_IAE(msg) {
    throw IllegalArgumentException_init_$Create$_0(msg);
  }
  function ensureNotNull(v) {
    var tmp;
    if (v == null) {
      THROW_NPE();
    } else {
      tmp = v;
    }
    return tmp;
  }
  function jsGenerateInterfaceSymbol() {
    return generateInterfaceSymbolById();
  }
  function createMetadata(kind, name, defaultConstructor, associatedObjectKey, associatedObjects, suspendArity) {
    var undef = VOID;
    return {kind: kind, simpleName: name, associatedObjectKey: associatedObjectKey, associatedObjects: associatedObjects, suspendArity: suspendArity, $kClass$: undef, defaultConstructor: defaultConstructor};
  }
  function initMetadataForClass(ctor, name, defaultConstructor, parent, interfaces, suspendArity, associatedObjectKey, associatedObjects) {
    var kind = 'class';
    initMetadataFor(kind, ctor, name, defaultConstructor, parent, interfaces, suspendArity, associatedObjectKey, associatedObjects);
  }
  function initMetadataFor(kind, ctor, name, defaultConstructor, parent, interfaces, suspendArity, associatedObjectKey, associatedObjects) {
    if (!(parent == null)) {
      ctor.prototype = Object.create(parent.prototype);
      ctor.prototype.constructor = ctor;
    }
    var metadata = createMetadata(kind, name, defaultConstructor, associatedObjectKey, associatedObjects, suspendArity);
    ctor.$metadata$ = metadata;
    var prototype = ctor.prototype;
    if (!(interfaces == null)) {
      var inductionVariable = 0;
      var last = interfaces.length;
      while (inductionVariable < last) {
        var i = interfaces[inductionVariable];
        inductionVariable = inductionVariable + 1 | 0;
        Object.assign(prototype, i.prototype);
        prototype[i.Symbol] = true;
      }
    }
    if (kind === 'interface') {
      ctor.Symbol = generateInterfaceSymbolById();
    }
  }
  function generateInterfaceSymbolById() {
    return '#__interface_' + generateInterfaceId();
  }
  function generateInterfaceId() {
    if (globalInterfaceId === VOID) {
      globalInterfaceId = 0;
    }
    // Inline function 'kotlin.js.unsafeCast' call
    globalInterfaceId = globalInterfaceId + 1 | 0;
    return globalInterfaceId;
  }
  var globalInterfaceId;
  function initMetadataForObject(ctor, name, defaultConstructor, parent, interfaces, suspendArity, associatedObjectKey, associatedObjects) {
    var kind = 'object';
    initMetadataFor(kind, ctor, name, defaultConstructor, parent, interfaces, suspendArity, associatedObjectKey, associatedObjects);
  }
  function initMetadataForInterface(ctor, name, defaultConstructor, parent, interfaces, suspendArity, associatedObjectKey, associatedObjects) {
    var kind = 'interface';
    initMetadataFor(kind, ctor, name, defaultConstructor, parent, interfaces, suspendArity, associatedObjectKey, associatedObjects);
  }
  function initMetadataForLambda(ctor, parent, interfaces, suspendArity) {
    initMetadataForClass(ctor, 'Lambda', VOID, parent, interfaces, suspendArity, VOID, VOID);
  }
  function initMetadataForCoroutine(ctor, parent, interfaces, suspendArity) {
    initMetadataForClass(ctor, 'Coroutine', VOID, parent, interfaces, suspendArity, VOID, VOID);
  }
  function initMetadataForFunctionReference(ctor, parent, interfaces, suspendArity) {
    initMetadataForClass(ctor, 'FunctionReference', VOID, parent, interfaces, suspendArity, VOID, VOID);
  }
  function initMetadataForCompanion(ctor, parent, interfaces, suspendArity) {
    initMetadataForObject(ctor, 'Companion', VOID, parent, interfaces, suspendArity, VOID, VOID);
  }
  function toByte(a) {
    // Inline function 'kotlin.js.unsafeCast' call
    return a << 24 >> 24;
  }
  function numberToInt(a) {
    var tmp;
    if (a instanceof Long) {
      tmp = convertToInt(a);
    } else {
      tmp = doubleToInt(a);
    }
    return tmp;
  }
  function doubleToInt(a) {
    var tmp;
    if (a > 2147483647) {
      tmp = 2147483647;
    } else if (a < -2147483648) {
      tmp = -2147483648;
    } else {
      // Inline function 'kotlin.js.jsBitwiseOr' call
      tmp = a | 0;
    }
    return tmp;
  }
  function toShort(a) {
    // Inline function 'kotlin.js.unsafeCast' call
    return a << 16 >> 16;
  }
  function numberToChar(a) {
    // Inline function 'kotlin.toUShort' call
    var this_0 = numberToInt(a);
    var tmp$ret$0 = _UShort___init__impl__jigrne(toShort(this_0));
    return _Char___init__impl__6a9atx_0(tmp$ret$0);
  }
  function numberRangeToNumber(start, endInclusive) {
    return new IntRange(start, endInclusive);
  }
  function get_propertyRefClassMetadataCache() {
    _init_properties_reflectRuntime_kt__5r4uu3();
    return propertyRefClassMetadataCache;
  }
  var propertyRefClassMetadataCache;
  function metadataObject() {
    _init_properties_reflectRuntime_kt__5r4uu3();
    return createMetadata('class', VOID, VOID, VOID, VOID, VOID);
  }
  function getPropertyCallableRef(name, paramCount, superType, getter, setter, linkageError) {
    _init_properties_reflectRuntime_kt__5r4uu3();
    getter.get = getter;
    getter.set = setter;
    getter.callableName = name;
    // Inline function 'kotlin.js.unsafeCast' call
    return getPropertyRefClass(getter, getKPropMetadata(paramCount, setter), superType);
  }
  function getPropertyRefClass(obj, metadata, superType) {
    _init_properties_reflectRuntime_kt__5r4uu3();
    obj.$metadata$ = metadata;
    obj.constructor = obj;
    var symbol = superType.Symbol;
    if (symbol != null) {
      // Inline function 'kotlin.js.asDynamic' call
      obj[symbol] = true;
    }
    Object.assign(obj, superType.prototype);
    return obj;
  }
  function getKPropMetadata(paramCount, setter) {
    _init_properties_reflectRuntime_kt__5r4uu3();
    return get_propertyRefClassMetadataCache()[paramCount][setter == null ? 0 : 1];
  }
  function getLocalDelegateReference(name, superType, mutable) {
    _init_properties_reflectRuntime_kt__5r4uu3();
    var lambda = getLocalDelegateReference$lambda();
    return getPropertyCallableRef(name, 0, superType, lambda, mutable ? lambda : null, VOID);
  }
  function constructCallableReference(callable, arity, flags, signatureId, name, bounds) {
    _init_properties_reflectRuntime_kt__5r4uu3();
    callable.callableName = name;
    callable.$flags = flags;
    callable.$arity = arity;
    callable.$id = signatureId;
    callable.$bound = bounds;
    return callable;
  }
  function getLocalDelegateReference$lambda() {
    return function () {
      throwUnsupportedOperationException('Not supported for local property reference.');
    };
  }
  var properties_initialized_reflectRuntime_kt_inkhwd;
  function _init_properties_reflectRuntime_kt__5r4uu3() {
    if (!properties_initialized_reflectRuntime_kt_inkhwd) {
      properties_initialized_reflectRuntime_kt_inkhwd = true;
      // Inline function 'kotlin.arrayOf' call
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      var tmp = [metadataObject(), metadataObject()];
      // Inline function 'kotlin.arrayOf' call
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      var tmp_0 = [metadataObject(), metadataObject()];
      // Inline function 'kotlin.arrayOf' call
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      // Inline function 'kotlin.arrayOf' call
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      propertyRefClassMetadataCache = [tmp, tmp_0, [metadataObject(), metadataObject()]];
    }
  }
  function isArrayish(o) {
    return isJsArray(o) || isView(o);
  }
  function isJsArray(obj) {
    // Inline function 'kotlin.js.unsafeCast' call
    return Array.isArray(obj);
  }
  function isCallableReference(value) {
    return typeof value === 'function' && value.$flags != null && value.$arity != null;
  }
  function isInterface(obj, iface) {
    return obj[iface.Symbol] === true;
  }
  function isArray(obj) {
    var tmp;
    if (isJsArray(obj)) {
      // Inline function 'kotlin.js.asDynamic' call
      tmp = !obj.$type$;
    } else {
      tmp = false;
    }
    return tmp;
  }
  function isNumber(a) {
    var tmp;
    if (typeof a === 'number') {
      tmp = true;
    } else {
      tmp = a instanceof Long;
    }
    return tmp;
  }
  function isComparable(value) {
    var type = typeof value;
    return type === 'string' || type === 'boolean' || isNumber(value) || isInterface(value, Comparable);
  }
  function isCharSequence(value) {
    return typeof value === 'string' || isInterface(value, CharSequence);
  }
  function get_VOID() {
    _init_properties_void_kt__3zg9as();
    return VOID;
  }
  var VOID;
  var properties_initialized_void_kt_e4ret2;
  function _init_properties_void_kt__3zg9as() {
    if (!properties_initialized_void_kt_e4ret2) {
      properties_initialized_void_kt_e4ret2 = true;
      VOID = void 0;
    }
  }
  function copyOf(_this__u8e3s4, newSize) {
    // Inline function 'kotlin.require' call
    if (!(newSize >= 0)) {
      var message = 'Invalid new array size: ' + newSize + '.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    var size = _this__u8e3s4.length;
    var tmp;
    if (newSize < 16 || size < 16) {
      tmp = fillFrom(_this__u8e3s4, new Int32Array(newSize));
    } else if (newSize > size) {
      // Inline function 'kotlin.also' call
      var this_0 = new Int32Array(newSize);
      // Inline function 'kotlin.js.asDynamic' call
      this_0.set(_this__u8e3s4);
      tmp = this_0;
    } else {
      // Inline function 'kotlin.js.asDynamic' call
      tmp = _this__u8e3s4.slice(0, newSize);
    }
    return tmp;
  }
  function copyOf_0(_this__u8e3s4, newSize) {
    // Inline function 'kotlin.require' call
    if (!(newSize >= 0)) {
      var message = 'Invalid new array size: ' + newSize + '.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    return arrayCopyResize(_this__u8e3s4, newSize, null);
  }
  function asList(_this__u8e3s4) {
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.js.asDynamic' call
    return new ArrayList(_this__u8e3s4);
  }
  function sortWith(_this__u8e3s4, comparator) {
    if (_this__u8e3s4.length > 1) {
      sortArrayWith(_this__u8e3s4, comparator);
    }
  }
  function copyOf_1(_this__u8e3s4, newSize) {
    // Inline function 'kotlin.require' call
    if (!(newSize >= 0)) {
      var message = 'Invalid new array size: ' + newSize + '.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    var size = _this__u8e3s4.length;
    var tmp;
    if (newSize < 16 || size < 16) {
      tmp = fillFrom(_this__u8e3s4, new Int8Array(newSize));
    } else if (newSize > size) {
      // Inline function 'kotlin.also' call
      var this_0 = new Int8Array(newSize);
      // Inline function 'kotlin.js.asDynamic' call
      this_0.set(_this__u8e3s4);
      tmp = this_0;
    } else {
      // Inline function 'kotlin.js.asDynamic' call
      tmp = _this__u8e3s4.slice(0, newSize);
    }
    return tmp;
  }
  function digitToIntImpl(_this__u8e3s4) {
    // Inline function 'kotlin.code' call
    var ch = Char__toInt_impl_vasixd(_this__u8e3s4);
    var index = binarySearchRange(Digit_getInstance().rangeStart_1, ch);
    var diff = ch - Digit_getInstance().rangeStart_1[index] | 0;
    return diff < 10 ? diff : -1;
  }
  function binarySearchRange(array, needle) {
    var bottom = 0;
    var top = array.length - 1 | 0;
    var middle = -1;
    var value = 0;
    while (bottom <= top) {
      middle = (bottom + top | 0) / 2 | 0;
      value = array[middle];
      if (needle > value)
        bottom = middle + 1 | 0;
      else if (needle === value)
        return middle;
      else
        top = middle - 1 | 0;
    }
    return middle - (needle < value ? 1 : 0) | 0;
  }
  function Digit() {
    Digit_instance = this;
    var tmp = this;
    // Inline function 'kotlin.intArrayOf' call
    tmp.rangeStart_1 = new Int32Array([48, 1632, 1776, 1984, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302, 3430, 3558, 3664, 3792, 3872, 4160, 4240, 6112, 6160, 6470, 6608, 6784, 6800, 6992, 7088, 7232, 7248, 42528, 43216, 43264, 43472, 43504, 43600, 44016, 65296]);
  }
  var Digit_instance;
  function Digit_getInstance() {
    if (Digit_instance == null)
      new Digit();
    return Digit_instance;
  }
  function isWhitespaceImpl(_this__u8e3s4) {
    // Inline function 'kotlin.code' call
    var ch = Char__toInt_impl_vasixd(_this__u8e3s4);
    return (9 <= ch ? ch <= 13 : false) || (28 <= ch ? ch <= 32 : false) || ch === 160 || (ch > 4096 && (ch === 5760 || (8192 <= ch ? ch <= 8202 : false) || ch === 8232 || ch === 8233 || ch === 8239 || ch === 8287 || ch === 12288));
  }
  function Comparator() {
  }
  function isNaN_0(_this__u8e3s4) {
    return !(_this__u8e3s4 === _this__u8e3s4);
  }
  function takeHighestOneBit(_this__u8e3s4) {
    var tmp;
    if (_this__u8e3s4 === 0) {
      tmp = 0;
    } else {
      // Inline function 'kotlin.countLeadingZeroBits' call
      tmp = 1 << (31 - clz32(_this__u8e3s4) | 0);
    }
    return tmp;
  }
  function isFinite(_this__u8e3s4) {
    return !isInfinite(_this__u8e3s4) && !isNaN_0(_this__u8e3s4);
  }
  function isInfinite(_this__u8e3s4) {
    return _this__u8e3s4 === Infinity || _this__u8e3s4 === -Infinity;
  }
  function Unit() {
  }
  protoOf(Unit).toString = function () {
    return 'kotlin.Unit';
  };
  var Unit_instance;
  function Unit_getInstance() {
    return Unit_instance;
  }
  function copyToArray(collection) {
    var tmp;
    // Inline function 'kotlin.js.asDynamic' call
    if (collection.toArray !== undefined) {
      // Inline function 'kotlin.js.asDynamic' call
      // Inline function 'kotlin.js.unsafeCast' call
      tmp = collection.toArray();
    } else {
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      tmp = collectionToArray(collection);
    }
    return tmp;
  }
  function checkIndexOverflow(index) {
    if (index < 0) {
      throwIndexOverflow();
    }
    return index;
  }
  function collectionToArray(collection) {
    return collectionToArrayCommonImpl(collection);
  }
  function sortWith_0(_this__u8e3s4, comparator) {
    collectionsSort(_this__u8e3s4, comparator);
  }
  function listOf(element) {
    // Inline function 'kotlin.arrayOf' call
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.js.asDynamic' call
    var tmp$ret$0 = [element];
    return new ArrayList(tmp$ret$0);
  }
  function mapOf(pair) {
    return hashMapOf([pair]);
  }
  function mapCapacity(expectedSize) {
    return expectedSize;
  }
  function setOf(element) {
    return hashSetOf([element]);
  }
  function checkCountOverflow(count) {
    if (count < 0) {
      throwCountOverflow();
    }
    return count;
  }
  function collectionsSort(list, comparator) {
    if (list.get_size_woubt6_k$() <= 1)
      return Unit_instance;
    var array = copyToArray(list);
    sortArrayWith(array, comparator);
    var inductionVariable = 0;
    var last = array.length;
    if (inductionVariable < last)
      do {
        var i = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        list.set_82063s_k$(i, array[i]);
      }
       while (inductionVariable < last);
  }
  function AbstractMutableCollection() {
    AbstractCollection.call(this);
  }
  protoOf(AbstractMutableCollection).remove_cedx0m_k$ = function (element) {
    this.checkIsMutable_jn1ih0_k$();
    var iterator = this.iterator_jk1svi_k$();
    while (iterator.hasNext_bitz1p_k$()) {
      if (equals(iterator.next_20eer_k$(), element)) {
        iterator.remove_ldkf9o_k$();
        return true;
      }
    }
    return false;
  };
  protoOf(AbstractMutableCollection).addAll_h3ej1q_k$ = function (elements) {
    this.checkIsMutable_jn1ih0_k$();
    var modified = false;
    var _iterator__ex2g4s = elements.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      if (this.add_utx5q5_k$(element))
        modified = true;
    }
    return modified;
  };
  protoOf(AbstractMutableCollection).clear_j9egeb_k$ = function () {
    this.checkIsMutable_jn1ih0_k$();
    var iterator = this.iterator_jk1svi_k$();
    while (iterator.hasNext_bitz1p_k$()) {
      iterator.next_20eer_k$();
      iterator.remove_ldkf9o_k$();
    }
  };
  protoOf(AbstractMutableCollection).toJSON = function () {
    return this.toArray();
  };
  protoOf(AbstractMutableCollection).checkIsMutable_jn1ih0_k$ = function () {
  };
  function IteratorImpl($outer) {
    this.$this_1 = $outer;
    this.index_1 = 0;
    this.last_1 = -1;
  }
  protoOf(IteratorImpl).hasNext_bitz1p_k$ = function () {
    return this.index_1 < this.$this_1.get_size_woubt6_k$();
  };
  protoOf(IteratorImpl).next_20eer_k$ = function () {
    if (!this.hasNext_bitz1p_k$())
      throw NoSuchElementException_init_$Create$();
    var tmp = this;
    var _unary__edvuaz = this.index_1;
    this.index_1 = _unary__edvuaz + 1 | 0;
    tmp.last_1 = _unary__edvuaz;
    return this.$this_1.get_c1px32_k$(this.last_1);
  };
  protoOf(IteratorImpl).remove_ldkf9o_k$ = function () {
    // Inline function 'kotlin.check' call
    if (!!(this.last_1 === -1)) {
      var message = 'Call next() or previous() before removing element from the iterator.';
      throw IllegalStateException_init_$Create$_0(toString_1(message));
    }
    this.$this_1.removeAt_6niowx_k$(this.last_1);
    this.index_1 = this.last_1;
    this.last_1 = -1;
  };
  function ListIteratorImpl($outer, index) {
    this.$this_2 = $outer;
    IteratorImpl.call(this, $outer);
    Companion_instance_4.checkPositionIndex_w4k0on_k$(index, this.$this_2.get_size_woubt6_k$());
    this.index_1 = index;
  }
  function SubList(list, fromIndex, toIndex) {
    AbstractMutableList.call(this);
    this.list_1 = list;
    this.fromIndex_1 = fromIndex;
    this._size_1 = 0;
    Companion_instance_4.checkRangeIndexes_mmy49x_k$(this.fromIndex_1, toIndex, this.list_1.get_size_woubt6_k$());
    this._size_1 = toIndex - this.fromIndex_1 | 0;
  }
  protoOf(SubList).add_dl6gt3_k$ = function (index, element) {
    Companion_instance_4.checkPositionIndex_w4k0on_k$(index, this._size_1);
    this.list_1.add_dl6gt3_k$(this.fromIndex_1 + index | 0, element);
    this._size_1 = this._size_1 + 1 | 0;
  };
  protoOf(SubList).get_c1px32_k$ = function (index) {
    Companion_instance_4.checkElementIndex_s0yg86_k$(index, this._size_1);
    return this.list_1.get_c1px32_k$(this.fromIndex_1 + index | 0);
  };
  protoOf(SubList).removeAt_6niowx_k$ = function (index) {
    Companion_instance_4.checkElementIndex_s0yg86_k$(index, this._size_1);
    var result = this.list_1.removeAt_6niowx_k$(this.fromIndex_1 + index | 0);
    this._size_1 = this._size_1 - 1 | 0;
    return result;
  };
  protoOf(SubList).set_82063s_k$ = function (index, element) {
    Companion_instance_4.checkElementIndex_s0yg86_k$(index, this._size_1);
    return this.list_1.set_82063s_k$(this.fromIndex_1 + index | 0, element);
  };
  protoOf(SubList).removeRange_sm1kzt_k$ = function (fromIndex, toIndex) {
    this.list_1.removeRange_sm1kzt_k$(this.fromIndex_1 + fromIndex | 0, this.fromIndex_1 + toIndex | 0);
    this._size_1 = this._size_1 - (toIndex - fromIndex | 0) | 0;
  };
  protoOf(SubList).get_size_woubt6_k$ = function () {
    return this._size_1;
  };
  protoOf(SubList).checkIsMutable_jn1ih0_k$ = function () {
    return this.list_1.checkIsMutable_jn1ih0_k$();
  };
  function AbstractMutableList() {
    AbstractMutableCollection.call(this);
    this.modCount_1 = 0;
  }
  protoOf(AbstractMutableList).add_utx5q5_k$ = function (element) {
    this.checkIsMutable_jn1ih0_k$();
    this.add_dl6gt3_k$(this.get_size_woubt6_k$(), element);
    return true;
  };
  protoOf(AbstractMutableList).clear_j9egeb_k$ = function () {
    this.checkIsMutable_jn1ih0_k$();
    this.removeRange_sm1kzt_k$(0, this.get_size_woubt6_k$());
  };
  protoOf(AbstractMutableList).iterator_jk1svi_k$ = function () {
    return new IteratorImpl(this);
  };
  protoOf(AbstractMutableList).contains_aljjnj_k$ = function (element) {
    return this.indexOf_si1fv9_k$(element) >= 0;
  };
  protoOf(AbstractMutableList).indexOf_si1fv9_k$ = function (element) {
    var tmp$ret$0;
    $l$block: {
      // Inline function 'kotlin.collections.indexOfFirst' call
      var index = 0;
      var _iterator__ex2g4s = this.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var item = _iterator__ex2g4s.next_20eer_k$();
        if (equals(item, element)) {
          tmp$ret$0 = index;
          break $l$block;
        }
        index = index + 1 | 0;
      }
      tmp$ret$0 = -1;
    }
    return tmp$ret$0;
  };
  protoOf(AbstractMutableList).listIterator_70e65o_k$ = function (index) {
    return new ListIteratorImpl(this, index);
  };
  protoOf(AbstractMutableList).subList_xle3r2_k$ = function (fromIndex, toIndex) {
    return new SubList(this, fromIndex, toIndex);
  };
  protoOf(AbstractMutableList).removeRange_sm1kzt_k$ = function (fromIndex, toIndex) {
    var iterator = this.listIterator_70e65o_k$(fromIndex);
    // Inline function 'kotlin.repeat' call
    var times = toIndex - fromIndex | 0;
    var inductionVariable = 0;
    if (inductionVariable < times)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        iterator.next_20eer_k$();
        iterator.remove_ldkf9o_k$();
      }
       while (inductionVariable < times);
  };
  protoOf(AbstractMutableList).equals = function (other) {
    if (other === this)
      return true;
    if (!(!(other == null) ? isInterface(other, KtList) : false))
      return false;
    return Companion_instance_4.orderedEquals_jt170c_k$(this, other);
  };
  protoOf(AbstractMutableList).hashCode = function () {
    return Companion_instance_4.orderedHashCode_srkix_k$(this);
  };
  function AbstractMutableMap() {
    AbstractMap.call(this);
    this.keysView_1 = null;
    this.valuesView_1 = null;
  }
  protoOf(AbstractMutableMap).createKeysView_aa1bmb_k$ = function () {
    return new HashMapKeysDefault(this);
  };
  protoOf(AbstractMutableMap).createValuesView_4isqvv_k$ = function () {
    return new HashMapValuesDefault(this);
  };
  protoOf(AbstractMutableMap).get_keys_wop4xp_k$ = function () {
    var tmp0_elvis_lhs = this.keysView_1;
    var tmp;
    if (tmp0_elvis_lhs == null) {
      // Inline function 'kotlin.also' call
      var this_0 = this.createKeysView_aa1bmb_k$();
      this.keysView_1 = this_0;
      tmp = this_0;
    } else {
      tmp = tmp0_elvis_lhs;
    }
    return tmp;
  };
  protoOf(AbstractMutableMap).get_values_ksazhn_k$ = function () {
    var tmp0_elvis_lhs = this.valuesView_1;
    var tmp;
    if (tmp0_elvis_lhs == null) {
      // Inline function 'kotlin.also' call
      var this_0 = this.createValuesView_4isqvv_k$();
      this.valuesView_1 = this_0;
      tmp = this_0;
    } else {
      tmp = tmp0_elvis_lhs;
    }
    return tmp;
  };
  protoOf(AbstractMutableMap).clear_j9egeb_k$ = function () {
    this.get_entries_p20ztl_k$().clear_j9egeb_k$();
  };
  protoOf(AbstractMutableMap).remove_gppy8k_k$ = function (key) {
    this.checkIsMutable_jn1ih0_k$();
    var iter = this.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (iter.hasNext_bitz1p_k$()) {
      var entry = iter.next_20eer_k$();
      var k = entry.get_key_18j28a_k$();
      if (equals(key, k)) {
        var value = entry.get_value_j01efc_k$();
        iter.remove_ldkf9o_k$();
        return value;
      }
    }
    return null;
  };
  protoOf(AbstractMutableMap).checkIsMutable_jn1ih0_k$ = function () {
  };
  function AbstractMutableSet() {
    AbstractMutableCollection.call(this);
  }
  protoOf(AbstractMutableSet).equals = function (other) {
    if (other === this)
      return true;
    if (!(!(other == null) ? isInterface(other, KtSet) : false))
      return false;
    return Companion_instance_6.setEquals_mjzluv_k$(this, other);
  };
  protoOf(AbstractMutableSet).hashCode = function () {
    return Companion_instance_6.unorderedHashCode_8c2ypq_k$(this);
  };
  function arrayOfUninitializedElements(capacity) {
    // Inline function 'kotlin.require' call
    if (!(capacity >= 0)) {
      var message = 'capacity must be non-negative.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    // Inline function 'kotlin.arrayOfNulls' call
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.js.asDynamic' call
    return Array(capacity);
  }
  function resetRange(_this__u8e3s4, fromIndex, toIndex) {
    // Inline function 'kotlin.js.nativeFill' call
    // Inline function 'kotlin.js.asDynamic' call
    _this__u8e3s4.fill(null, fromIndex, toIndex);
  }
  function copyOfUninitializedElements(_this__u8e3s4, newSize) {
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.js.asDynamic' call
    return copyOf_0(_this__u8e3s4, newSize);
  }
  function resetAt(_this__u8e3s4, index) {
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.js.asDynamic' call
    _this__u8e3s4[index] = null;
  }
  function Companion_2() {
    Companion_instance_2 = this;
    var tmp = this;
    // Inline function 'kotlin.also' call
    var this_0 = ArrayList_init_$Create$_0(0);
    this_0.isReadOnly_1 = true;
    tmp.Empty_1 = this_0;
  }
  var Companion_instance_2;
  function Companion_getInstance_2() {
    if (Companion_instance_2 == null)
      new Companion_2();
    return Companion_instance_2;
  }
  function ArrayList_init_$Init$($this) {
    // Inline function 'kotlin.emptyArray' call
    var tmp$ret$0 = [];
    ArrayList.call($this, tmp$ret$0);
    return $this;
  }
  function ArrayList_init_$Create$() {
    return ArrayList_init_$Init$(objectCreate(protoOf(ArrayList)));
  }
  function ArrayList_init_$Init$_0(initialCapacity, $this) {
    // Inline function 'kotlin.emptyArray' call
    var tmp$ret$0 = [];
    ArrayList.call($this, tmp$ret$0);
    // Inline function 'kotlin.require' call
    if (!(initialCapacity >= 0)) {
      var message = 'Negative initial capacity: ' + initialCapacity;
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    return $this;
  }
  function ArrayList_init_$Create$_0(initialCapacity) {
    return ArrayList_init_$Init$_0(initialCapacity, objectCreate(protoOf(ArrayList)));
  }
  function ArrayList_init_$Init$_1(elements, $this) {
    // Inline function 'kotlin.collections.toTypedArray' call
    var tmp$ret$0 = copyToArray(elements);
    ArrayList.call($this, tmp$ret$0);
    return $this;
  }
  function ArrayList_init_$Create$_1(elements) {
    return ArrayList_init_$Init$_1(elements, objectCreate(protoOf(ArrayList)));
  }
  function increaseLength($this, amount) {
    var previous = $this.get_size_woubt6_k$();
    // Inline function 'kotlin.js.asDynamic' call
    $this.array_1.length = $this.get_size_woubt6_k$() + amount | 0;
    return previous;
  }
  function rangeCheck($this, index) {
    // Inline function 'kotlin.apply' call
    Companion_instance_4.checkElementIndex_s0yg86_k$(index, $this.get_size_woubt6_k$());
    return index;
  }
  function insertionRangeCheck($this, index) {
    // Inline function 'kotlin.apply' call
    Companion_instance_4.checkPositionIndex_w4k0on_k$(index, $this.get_size_woubt6_k$());
    return index;
  }
  function ArrayList(array) {
    Companion_getInstance_2();
    AbstractMutableList.call(this);
    this.array_1 = array;
    this.isReadOnly_1 = false;
  }
  protoOf(ArrayList).get_size_woubt6_k$ = function () {
    return this.array_1.length;
  };
  protoOf(ArrayList).get_c1px32_k$ = function (index) {
    return this.array_1[rangeCheck(this, index)];
  };
  protoOf(ArrayList).set_82063s_k$ = function (index, element) {
    this.checkIsMutable_jn1ih0_k$();
    rangeCheck(this, index);
    // Inline function 'kotlin.apply' call
    var this_0 = this.array_1[index];
    this.array_1[index] = element;
    return this_0;
  };
  protoOf(ArrayList).add_utx5q5_k$ = function (element) {
    this.checkIsMutable_jn1ih0_k$();
    // Inline function 'kotlin.js.asDynamic' call
    this.array_1.push(element);
    this.modCount_1 = this.modCount_1 + 1 | 0;
    return true;
  };
  protoOf(ArrayList).add_dl6gt3_k$ = function (index, element) {
    this.checkIsMutable_jn1ih0_k$();
    // Inline function 'kotlin.js.asDynamic' call
    this.array_1.splice(insertionRangeCheck(this, index), 0, element);
    this.modCount_1 = this.modCount_1 + 1 | 0;
  };
  protoOf(ArrayList).addAll_h3ej1q_k$ = function (elements) {
    this.checkIsMutable_jn1ih0_k$();
    if (elements.isEmpty_y1axqb_k$())
      return false;
    var offset = increaseLength(this, elements.get_size_woubt6_k$());
    // Inline function 'kotlin.collections.forEachIndexed' call
    var index = 0;
    var _iterator__ex2g4s = elements.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var _unary__edvuaz = index;
      index = _unary__edvuaz + 1 | 0;
      var index_0 = checkIndexOverflow(_unary__edvuaz);
      this.array_1[offset + index_0 | 0] = item;
    }
    this.modCount_1 = this.modCount_1 + 1 | 0;
    return true;
  };
  protoOf(ArrayList).removeAt_6niowx_k$ = function (index) {
    this.checkIsMutable_jn1ih0_k$();
    rangeCheck(this, index);
    this.modCount_1 = this.modCount_1 + 1 | 0;
    var tmp;
    if (index === get_lastIndex_0(this)) {
      // Inline function 'kotlin.js.asDynamic' call
      tmp = this.array_1.pop();
    } else {
      // Inline function 'kotlin.js.asDynamic' call
      tmp = this.array_1.splice(index, 1)[0];
    }
    return tmp;
  };
  protoOf(ArrayList).remove_cedx0m_k$ = function (element) {
    this.checkIsMutable_jn1ih0_k$();
    var inductionVariable = 0;
    var last = this.array_1.length - 1 | 0;
    if (inductionVariable <= last)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        if (equals(this.array_1[index], element)) {
          // Inline function 'kotlin.js.asDynamic' call
          this.array_1.splice(index, 1);
          this.modCount_1 = this.modCount_1 + 1 | 0;
          return true;
        }
      }
       while (inductionVariable <= last);
    return false;
  };
  protoOf(ArrayList).removeRange_sm1kzt_k$ = function (fromIndex, toIndex) {
    this.checkIsMutable_jn1ih0_k$();
    this.modCount_1 = this.modCount_1 + 1 | 0;
    // Inline function 'kotlin.js.asDynamic' call
    this.array_1.splice(fromIndex, toIndex - fromIndex | 0);
  };
  protoOf(ArrayList).clear_j9egeb_k$ = function () {
    this.checkIsMutable_jn1ih0_k$();
    var tmp = this;
    // Inline function 'kotlin.emptyArray' call
    tmp.array_1 = [];
    this.modCount_1 = this.modCount_1 + 1 | 0;
  };
  protoOf(ArrayList).indexOf_si1fv9_k$ = function (element) {
    return indexOf(this.array_1, element);
  };
  protoOf(ArrayList).toString = function () {
    return arrayToString(this.array_1);
  };
  protoOf(ArrayList).toArray_jjyjqa_k$ = function () {
    return [].slice.call(this.array_1);
  };
  protoOf(ArrayList).toArray = function () {
    return this.toArray_jjyjqa_k$();
  };
  protoOf(ArrayList).checkIsMutable_jn1ih0_k$ = function () {
    if (this.isReadOnly_1)
      throw UnsupportedOperationException_init_$Create$();
  };
  var _stableSortingIsSupported;
  function sortArrayWith(array, comparator) {
    if (getStableSortingIsSupported()) {
      var comparison = sortArrayWith$lambda(comparator);
      // Inline function 'kotlin.js.asDynamic' call
      array.sort(comparison);
    } else {
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      mergeSort(array, 0, get_lastIndex(array), comparator);
    }
  }
  function getStableSortingIsSupported() {
    var tmp0_safe_receiver = _stableSortingIsSupported;
    if (tmp0_safe_receiver == null)
      null;
    else {
      // Inline function 'kotlin.let' call
      return tmp0_safe_receiver;
    }
    _stableSortingIsSupported = false;
    // Inline function 'kotlin.js.unsafeCast' call
    var array = [];
    var inductionVariable = 0;
    if (inductionVariable < 600)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        // Inline function 'kotlin.js.asDynamic' call
        array.push(index);
      }
       while (inductionVariable < 600);
    var comparison = getStableSortingIsSupported$lambda;
    // Inline function 'kotlin.js.asDynamic' call
    array.sort(comparison);
    var inductionVariable_0 = 1;
    var last = array.length;
    if (inductionVariable_0 < last)
      do {
        var index_0 = inductionVariable_0;
        inductionVariable_0 = inductionVariable_0 + 1 | 0;
        var a = array[index_0 - 1 | 0];
        var b = array[index_0];
        if ((a & 3) === (b & 3) && a >= b)
          return false;
      }
       while (inductionVariable_0 < last);
    _stableSortingIsSupported = true;
    return true;
  }
  function mergeSort(array, start, endInclusive, comparator) {
    // Inline function 'kotlin.arrayOfNulls' call
    var size = array.length;
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.js.asDynamic' call
    var buffer = Array(size);
    var result = mergeSort_0(array, buffer, start, endInclusive, comparator);
    if (!(result === array)) {
      var inductionVariable = start;
      if (inductionVariable <= endInclusive)
        do {
          var i = inductionVariable;
          inductionVariable = inductionVariable + 1 | 0;
          array[i] = result[i];
        }
         while (!(i === endInclusive));
    }
  }
  function mergeSort_0(array, buffer, start, end, comparator) {
    if (start === end) {
      return array;
    }
    var median = (start + end | 0) / 2 | 0;
    var left = mergeSort_0(array, buffer, start, median, comparator);
    var right = mergeSort_0(array, buffer, median + 1 | 0, end, comparator);
    var target = left === buffer ? array : buffer;
    var leftIndex = start;
    var rightIndex = median + 1 | 0;
    var inductionVariable = start;
    if (inductionVariable <= end)
      do {
        var i = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        if (leftIndex <= median && rightIndex <= end) {
          var leftValue = left[leftIndex];
          var rightValue = right[rightIndex];
          if (comparator.compare(leftValue, rightValue) <= 0) {
            target[i] = leftValue;
            leftIndex = leftIndex + 1 | 0;
          } else {
            target[i] = rightValue;
            rightIndex = rightIndex + 1 | 0;
          }
        } else if (leftIndex <= median) {
          target[i] = left[leftIndex];
          leftIndex = leftIndex + 1 | 0;
        } else {
          target[i] = right[rightIndex];
          rightIndex = rightIndex + 1 | 0;
        }
      }
       while (!(i === end));
    return target;
  }
  function sortArrayWith$lambda($comparator) {
    return function (a, b) {
      return $comparator.compare(a, b);
    };
  }
  function getStableSortingIsSupported$lambda(a, b) {
    return (a & 3) - (b & 3) | 0;
  }
  function HashMap_init_$Init$(internalMap, $this) {
    AbstractMutableMap.call($this);
    HashMap.call($this);
    $this.internalMap_1 = internalMap;
    return $this;
  }
  function HashMap_init_$Init$_0($this) {
    HashMap_init_$Init$(InternalHashMap_init_$Create$(), $this);
    return $this;
  }
  function HashMap_init_$Create$() {
    return HashMap_init_$Init$_0(objectCreate(protoOf(HashMap)));
  }
  function HashMap_init_$Init$_1(initialCapacity, loadFactor, $this) {
    HashMap_init_$Init$(InternalHashMap_init_$Create$_2(initialCapacity, loadFactor), $this);
    return $this;
  }
  function HashMap_init_$Init$_2(initialCapacity, $this) {
    HashMap_init_$Init$_1(initialCapacity, 1.0, $this);
    return $this;
  }
  function HashMap_init_$Create$_0(initialCapacity) {
    return HashMap_init_$Init$_2(initialCapacity, objectCreate(protoOf(HashMap)));
  }
  function HashMap_init_$Init$_3(original, $this) {
    HashMap_init_$Init$(InternalHashMap_init_$Create$_1(original), $this);
    return $this;
  }
  protoOf(HashMap).clear_j9egeb_k$ = function () {
    this.internalMap_1.clear_j9egeb_k$();
  };
  protoOf(HashMap).containsKey_aw81wo_k$ = function (key) {
    return this.internalMap_1.contains_vbgn2f_k$(key);
  };
  protoOf(HashMap).containsValue_yf2ykl_k$ = function (value) {
    return this.internalMap_1.containsValue_yf2ykl_k$(value);
  };
  protoOf(HashMap).createKeysView_aa1bmb_k$ = function () {
    return new HashMapKeys(this.internalMap_1);
  };
  protoOf(HashMap).createValuesView_4isqvv_k$ = function () {
    return new HashMapValues(this.internalMap_1);
  };
  protoOf(HashMap).get_entries_p20ztl_k$ = function () {
    var tmp0_elvis_lhs = this.entriesView_1;
    var tmp;
    if (tmp0_elvis_lhs == null) {
      // Inline function 'kotlin.also' call
      var this_0 = new HashMapEntrySet(this.internalMap_1);
      this.entriesView_1 = this_0;
      tmp = this_0;
    } else {
      tmp = tmp0_elvis_lhs;
    }
    return tmp;
  };
  protoOf(HashMap).get_wei43m_k$ = function (key) {
    return this.internalMap_1.get_wei43m_k$(key);
  };
  protoOf(HashMap).put_4fpzoq_k$ = function (key, value) {
    return this.internalMap_1.put_4fpzoq_k$(key, value);
  };
  protoOf(HashMap).remove_gppy8k_k$ = function (key) {
    return this.internalMap_1.remove_gppy8k_k$(key);
  };
  protoOf(HashMap).get_size_woubt6_k$ = function () {
    return this.internalMap_1.get_size_woubt6_k$();
  };
  protoOf(HashMap).putAll_wgg6cj_k$ = function (from) {
    return this.internalMap_1.putAll_wgg6cj_k$(from);
  };
  function HashMap() {
    this.entriesView_1 = null;
  }
  function HashMapKeys(backing) {
    AbstractMutableSet.call(this);
    this.backing_1 = backing;
  }
  protoOf(HashMapKeys).get_size_woubt6_k$ = function () {
    return this.backing_1.get_size_woubt6_k$();
  };
  protoOf(HashMapKeys).isEmpty_y1axqb_k$ = function () {
    return this.backing_1.get_size_woubt6_k$() === 0;
  };
  protoOf(HashMapKeys).contains_aljjnj_k$ = function (element) {
    return this.backing_1.contains_vbgn2f_k$(element);
  };
  protoOf(HashMapKeys).clear_j9egeb_k$ = function () {
    return this.backing_1.clear_j9egeb_k$();
  };
  protoOf(HashMapKeys).add_utx5q5_k$ = function (element) {
    throw UnsupportedOperationException_init_$Create$();
  };
  protoOf(HashMapKeys).addAll_h3ej1q_k$ = function (elements) {
    throw UnsupportedOperationException_init_$Create$();
  };
  protoOf(HashMapKeys).iterator_jk1svi_k$ = function () {
    return this.backing_1.keysIterator_mjslfm_k$();
  };
  protoOf(HashMapKeys).checkIsMutable_jn1ih0_k$ = function () {
    return this.backing_1.checkIsMutable_h5js84_k$();
  };
  function HashMapValues(backing) {
    AbstractMutableCollection.call(this);
    this.backing_1 = backing;
  }
  protoOf(HashMapValues).get_size_woubt6_k$ = function () {
    return this.backing_1.get_size_woubt6_k$();
  };
  protoOf(HashMapValues).isEmpty_y1axqb_k$ = function () {
    return this.backing_1.get_size_woubt6_k$() === 0;
  };
  protoOf(HashMapValues).contains_m22g8e_k$ = function (element) {
    return this.backing_1.containsValue_yf2ykl_k$(element);
  };
  protoOf(HashMapValues).contains_aljjnj_k$ = function (element) {
    if (!true)
      return false;
    return this.contains_m22g8e_k$(element);
  };
  protoOf(HashMapValues).add_sqnzo4_k$ = function (element) {
    throw UnsupportedOperationException_init_$Create$();
  };
  protoOf(HashMapValues).add_utx5q5_k$ = function (element) {
    return this.add_sqnzo4_k$(element);
  };
  protoOf(HashMapValues).addAll_h3ejgd_k$ = function (elements) {
    throw UnsupportedOperationException_init_$Create$();
  };
  protoOf(HashMapValues).addAll_h3ej1q_k$ = function (elements) {
    return this.addAll_h3ejgd_k$(elements);
  };
  protoOf(HashMapValues).iterator_jk1svi_k$ = function () {
    return this.backing_1.valuesIterator_3ptos0_k$();
  };
  protoOf(HashMapValues).checkIsMutable_jn1ih0_k$ = function () {
    return this.backing_1.checkIsMutable_h5js84_k$();
  };
  function HashMapEntrySet(backing) {
    HashMapEntrySetBase.call(this, backing);
  }
  protoOf(HashMapEntrySet).iterator_jk1svi_k$ = function () {
    return this.backing_1.entriesIterator_or017i_k$();
  };
  function HashMapEntrySetBase(backing) {
    AbstractMutableSet.call(this);
    this.backing_1 = backing;
  }
  protoOf(HashMapEntrySetBase).get_size_woubt6_k$ = function () {
    return this.backing_1.get_size_woubt6_k$();
  };
  protoOf(HashMapEntrySetBase).isEmpty_y1axqb_k$ = function () {
    return this.backing_1.get_size_woubt6_k$() === 0;
  };
  protoOf(HashMapEntrySetBase).contains_pftbw2_k$ = function (element) {
    return this.backing_1.containsEntry_jg6xfi_k$(element);
  };
  protoOf(HashMapEntrySetBase).contains_aljjnj_k$ = function (element) {
    if (!(!(element == null) ? isInterface(element, Entry) : false))
      return false;
    return this.contains_pftbw2_k$((!(element == null) ? isInterface(element, Entry) : false) ? element : THROW_CCE());
  };
  protoOf(HashMapEntrySetBase).clear_j9egeb_k$ = function () {
    return this.backing_1.clear_j9egeb_k$();
  };
  protoOf(HashMapEntrySetBase).add_k8z7xs_k$ = function (element) {
    throw UnsupportedOperationException_init_$Create$();
  };
  protoOf(HashMapEntrySetBase).add_utx5q5_k$ = function (element) {
    return this.add_k8z7xs_k$((!(element == null) ? isInterface(element, Entry) : false) ? element : THROW_CCE());
  };
  protoOf(HashMapEntrySetBase).addAll_h3ej1q_k$ = function (elements) {
    throw UnsupportedOperationException_init_$Create$();
  };
  protoOf(HashMapEntrySetBase).containsAll_bwkf3g_k$ = function (elements) {
    return this.backing_1.containsAllEntries_m9iqdx_k$(elements);
  };
  protoOf(HashMapEntrySetBase).checkIsMutable_jn1ih0_k$ = function () {
    return this.backing_1.checkIsMutable_h5js84_k$();
  };
  function HashMapKeysDefault$iterator$1($entryIterator) {
    this.$entryIterator_1 = $entryIterator;
  }
  protoOf(HashMapKeysDefault$iterator$1).hasNext_bitz1p_k$ = function () {
    return this.$entryIterator_1.hasNext_bitz1p_k$();
  };
  protoOf(HashMapKeysDefault$iterator$1).next_20eer_k$ = function () {
    return this.$entryIterator_1.next_20eer_k$().get_key_18j28a_k$();
  };
  protoOf(HashMapKeysDefault$iterator$1).remove_ldkf9o_k$ = function () {
    return this.$entryIterator_1.remove_ldkf9o_k$();
  };
  function HashMapKeysDefault(backingMap) {
    AbstractMutableSet.call(this);
    this.backingMap_1 = backingMap;
  }
  protoOf(HashMapKeysDefault).add_b330zt_k$ = function (element) {
    throw UnsupportedOperationException_init_$Create$_0('Add is not supported on keys');
  };
  protoOf(HashMapKeysDefault).add_utx5q5_k$ = function (element) {
    return this.add_b330zt_k$(element);
  };
  protoOf(HashMapKeysDefault).clear_j9egeb_k$ = function () {
    return this.backingMap_1.clear_j9egeb_k$();
  };
  protoOf(HashMapKeysDefault).contains_vbgn2f_k$ = function (element) {
    return this.backingMap_1.containsKey_aw81wo_k$(element);
  };
  protoOf(HashMapKeysDefault).contains_aljjnj_k$ = function (element) {
    if (!true)
      return false;
    return this.contains_vbgn2f_k$(element);
  };
  protoOf(HashMapKeysDefault).iterator_jk1svi_k$ = function () {
    var entryIterator = this.backingMap_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    return new HashMapKeysDefault$iterator$1(entryIterator);
  };
  protoOf(HashMapKeysDefault).get_size_woubt6_k$ = function () {
    return this.backingMap_1.get_size_woubt6_k$();
  };
  protoOf(HashMapKeysDefault).checkIsMutable_jn1ih0_k$ = function () {
    return this.backingMap_1.checkIsMutable_jn1ih0_k$();
  };
  function HashMapValuesDefault$iterator$1($entryIterator) {
    this.$entryIterator_1 = $entryIterator;
  }
  protoOf(HashMapValuesDefault$iterator$1).hasNext_bitz1p_k$ = function () {
    return this.$entryIterator_1.hasNext_bitz1p_k$();
  };
  protoOf(HashMapValuesDefault$iterator$1).next_20eer_k$ = function () {
    return this.$entryIterator_1.next_20eer_k$().get_value_j01efc_k$();
  };
  protoOf(HashMapValuesDefault$iterator$1).remove_ldkf9o_k$ = function () {
    return this.$entryIterator_1.remove_ldkf9o_k$();
  };
  function HashMapValuesDefault(backingMap) {
    AbstractMutableCollection.call(this);
    this.backingMap_1 = backingMap;
  }
  protoOf(HashMapValuesDefault).add_sqnzo4_k$ = function (element) {
    throw UnsupportedOperationException_init_$Create$_0('Add is not supported on values');
  };
  protoOf(HashMapValuesDefault).add_utx5q5_k$ = function (element) {
    return this.add_sqnzo4_k$(element);
  };
  protoOf(HashMapValuesDefault).contains_m22g8e_k$ = function (element) {
    return this.backingMap_1.containsValue_yf2ykl_k$(element);
  };
  protoOf(HashMapValuesDefault).contains_aljjnj_k$ = function (element) {
    if (!true)
      return false;
    return this.contains_m22g8e_k$(element);
  };
  protoOf(HashMapValuesDefault).iterator_jk1svi_k$ = function () {
    var entryIterator = this.backingMap_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    return new HashMapValuesDefault$iterator$1(entryIterator);
  };
  protoOf(HashMapValuesDefault).get_size_woubt6_k$ = function () {
    return this.backingMap_1.get_size_woubt6_k$();
  };
  protoOf(HashMapValuesDefault).checkIsMutable_jn1ih0_k$ = function () {
    return this.backingMap_1.checkIsMutable_jn1ih0_k$();
  };
  function HashSet_init_$Init$(map, $this) {
    AbstractMutableSet.call($this);
    HashSet.call($this);
    $this.internalMap_1 = map;
    return $this;
  }
  function HashSet_init_$Init$_0($this) {
    HashSet_init_$Init$(InternalHashMap_init_$Create$(), $this);
    return $this;
  }
  function HashSet_init_$Create$() {
    return HashSet_init_$Init$_0(objectCreate(protoOf(HashSet)));
  }
  function HashSet_init_$Init$_1(elements, $this) {
    HashSet_init_$Init$(InternalHashMap_init_$Create$_0(elements.get_size_woubt6_k$()), $this);
    var _iterator__ex2g4s = elements.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      $this.internalMap_1.put_4fpzoq_k$(element, true);
    }
    return $this;
  }
  function HashSet_init_$Init$_2(initialCapacity, loadFactor, $this) {
    HashSet_init_$Init$(InternalHashMap_init_$Create$_2(initialCapacity, loadFactor), $this);
    return $this;
  }
  function HashSet_init_$Init$_3(initialCapacity, $this) {
    HashSet_init_$Init$_2(initialCapacity, 1.0, $this);
    return $this;
  }
  function HashSet_init_$Create$_0(initialCapacity) {
    return HashSet_init_$Init$_3(initialCapacity, objectCreate(protoOf(HashSet)));
  }
  protoOf(HashSet).add_utx5q5_k$ = function (element) {
    return this.internalMap_1.put_4fpzoq_k$(element, true) == null;
  };
  protoOf(HashSet).clear_j9egeb_k$ = function () {
    this.internalMap_1.clear_j9egeb_k$();
  };
  protoOf(HashSet).contains_aljjnj_k$ = function (element) {
    return this.internalMap_1.contains_vbgn2f_k$(element);
  };
  protoOf(HashSet).isEmpty_y1axqb_k$ = function () {
    return this.internalMap_1.get_size_woubt6_k$() === 0;
  };
  protoOf(HashSet).iterator_jk1svi_k$ = function () {
    return this.internalMap_1.keysIterator_mjslfm_k$();
  };
  protoOf(HashSet).get_size_woubt6_k$ = function () {
    return this.internalMap_1.get_size_woubt6_k$();
  };
  function HashSet() {
  }
  function computeHashSize($this, capacity) {
    return takeHighestOneBit(imul(coerceAtLeast(capacity, 1), 3));
  }
  function computeShift($this, hashSize) {
    // Inline function 'kotlin.countLeadingZeroBits' call
    return clz32(hashSize) + 1 | 0;
  }
  function checkForComodification($this) {
    if (!($this.map_1.modCount_1 === $this.expectedModCount_1))
      throw ConcurrentModificationException_init_$Create$_0('The backing map has been modified after this entry was obtained.');
  }
  function InternalHashMap_init_$Init$($this) {
    InternalHashMap_init_$Init$_0(8, $this);
    return $this;
  }
  function InternalHashMap_init_$Create$() {
    return InternalHashMap_init_$Init$(objectCreate(protoOf(InternalHashMap)));
  }
  function InternalHashMap_init_$Init$_0(initialCapacity, $this) {
    InternalHashMap.call($this, arrayOfUninitializedElements(initialCapacity), null, new Int32Array(initialCapacity), new Int32Array(computeHashSize(Companion_instance_3, initialCapacity)), 2, 0);
    return $this;
  }
  function InternalHashMap_init_$Create$_0(initialCapacity) {
    return InternalHashMap_init_$Init$_0(initialCapacity, objectCreate(protoOf(InternalHashMap)));
  }
  function InternalHashMap_init_$Init$_1(original, $this) {
    InternalHashMap_init_$Init$_0(original.get_size_woubt6_k$(), $this);
    $this.putAll_wgg6cj_k$(original);
    return $this;
  }
  function InternalHashMap_init_$Create$_1(original) {
    return InternalHashMap_init_$Init$_1(original, objectCreate(protoOf(InternalHashMap)));
  }
  function InternalHashMap_init_$Init$_2(initialCapacity, loadFactor, $this) {
    InternalHashMap_init_$Init$_0(initialCapacity, $this);
    // Inline function 'kotlin.require' call
    if (!(loadFactor > 0)) {
      var message = 'Non-positive load factor: ' + loadFactor;
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    return $this;
  }
  function InternalHashMap_init_$Create$_2(initialCapacity, loadFactor) {
    return InternalHashMap_init_$Init$_2(initialCapacity, loadFactor, objectCreate(protoOf(InternalHashMap)));
  }
  function _get_capacity__a9k9f3($this) {
    return $this.keysArray_1.length;
  }
  function _get_hashSize__tftcho($this) {
    return $this.hashArray_1.length;
  }
  function registerModification($this) {
    $this.modCount_1 = $this.modCount_1 + 1 | 0;
  }
  function ensureExtraCapacity($this, n) {
    if (shouldCompact($this, n)) {
      compact($this, true);
    } else {
      ensureCapacity($this, $this.length_1 + n | 0);
    }
  }
  function shouldCompact($this, extraCapacity) {
    var spareCapacity = _get_capacity__a9k9f3($this) - $this.length_1 | 0;
    var gaps = $this.length_1 - $this.get_size_woubt6_k$() | 0;
    return spareCapacity < extraCapacity && (gaps + spareCapacity | 0) >= extraCapacity && gaps >= (_get_capacity__a9k9f3($this) / 4 | 0);
  }
  function ensureCapacity($this, minCapacity) {
    if (minCapacity < 0)
      throw RuntimeException_init_$Create$_0('too many elements');
    if (minCapacity > _get_capacity__a9k9f3($this)) {
      var newSize = Companion_instance_4.newCapacity_k5ozfy_k$(_get_capacity__a9k9f3($this), minCapacity);
      $this.keysArray_1 = copyOfUninitializedElements($this.keysArray_1, newSize);
      var tmp = $this;
      var tmp0_safe_receiver = $this.valuesArray_1;
      tmp.valuesArray_1 = tmp0_safe_receiver == null ? null : copyOfUninitializedElements(tmp0_safe_receiver, newSize);
      $this.presenceArray_1 = copyOf($this.presenceArray_1, newSize);
      var newHashSize = computeHashSize(Companion_instance_3, newSize);
      if (newHashSize > _get_hashSize__tftcho($this)) {
        rehash($this, newHashSize);
      }
    }
  }
  function allocateValuesArray($this) {
    var curValuesArray = $this.valuesArray_1;
    if (!(curValuesArray == null))
      return curValuesArray;
    var newValuesArray = arrayOfUninitializedElements(_get_capacity__a9k9f3($this));
    $this.valuesArray_1 = newValuesArray;
    return newValuesArray;
  }
  function hash($this, key) {
    return key == null ? 0 : imul(hashCode_0(key), -1640531527) >>> $this.hashShift_1 | 0;
  }
  function compact($this, updateHashArray) {
    var i = 0;
    var j = 0;
    var valuesArray = $this.valuesArray_1;
    while (i < $this.length_1) {
      var hash = $this.presenceArray_1[i];
      if (hash >= 0) {
        $this.keysArray_1[j] = $this.keysArray_1[i];
        if (!(valuesArray == null)) {
          valuesArray[j] = valuesArray[i];
        }
        if (updateHashArray) {
          $this.presenceArray_1[j] = hash;
          $this.hashArray_1[hash] = j + 1 | 0;
        }
        j = j + 1 | 0;
      }
      i = i + 1 | 0;
    }
    resetRange($this.keysArray_1, j, $this.length_1);
    if (valuesArray == null)
      null;
    else {
      resetRange(valuesArray, j, $this.length_1);
    }
    $this.length_1 = j;
  }
  function rehash($this, newHashSize) {
    registerModification($this);
    if ($this.length_1 > $this._size_1) {
      compact($this, false);
    }
    $this.hashArray_1 = new Int32Array(newHashSize);
    $this.hashShift_1 = computeShift(Companion_instance_3, newHashSize);
    var i = 0;
    while (i < $this.length_1) {
      var _unary__edvuaz = i;
      i = _unary__edvuaz + 1 | 0;
      if (!putRehash($this, _unary__edvuaz)) {
        throw IllegalStateException_init_$Create$_0('This cannot happen with fixed magic multiplier and grow-only hash array. Have object hashCodes changed?');
      }
    }
  }
  function putRehash($this, i) {
    var hash_0 = hash($this, $this.keysArray_1[i]);
    var probesLeft = $this.maxProbeDistance_1;
    while (true) {
      var index = $this.hashArray_1[hash_0];
      if (index === 0) {
        $this.hashArray_1[hash_0] = i + 1 | 0;
        $this.presenceArray_1[i] = hash_0;
        return true;
      }
      probesLeft = probesLeft - 1 | 0;
      if (probesLeft < 0)
        return false;
      var _unary__edvuaz = hash_0;
      hash_0 = _unary__edvuaz - 1 | 0;
      if (_unary__edvuaz === 0)
        hash_0 = _get_hashSize__tftcho($this) - 1 | 0;
    }
  }
  function findKey($this, key) {
    var hash_0 = hash($this, key);
    var probesLeft = $this.maxProbeDistance_1;
    while (true) {
      var index = $this.hashArray_1[hash_0];
      if (index === 0)
        return -1;
      if (equals($this.keysArray_1[index - 1 | 0], key))
        return index - 1 | 0;
      probesLeft = probesLeft - 1 | 0;
      if (probesLeft < 0)
        return -1;
      var _unary__edvuaz = hash_0;
      hash_0 = _unary__edvuaz - 1 | 0;
      if (_unary__edvuaz === 0)
        hash_0 = _get_hashSize__tftcho($this) - 1 | 0;
    }
  }
  function findValue($this, value) {
    var i = $this.length_1;
    $l$loop: while (true) {
      i = i - 1 | 0;
      if (!(i >= 0)) {
        break $l$loop;
      }
      if ($this.presenceArray_1[i] >= 0 && equals(ensureNotNull($this.valuesArray_1)[i], value))
        return i;
    }
    return -1;
  }
  function addKey($this, key) {
    $this.checkIsMutable_h5js84_k$();
    retry: while (true) {
      var hash_0 = hash($this, key);
      var tentativeMaxProbeDistance = coerceAtMost(imul($this.maxProbeDistance_1, 2), _get_hashSize__tftcho($this) / 2 | 0);
      var probeDistance = 0;
      while (true) {
        var index = $this.hashArray_1[hash_0];
        if (index === 0) {
          if ($this.length_1 >= _get_capacity__a9k9f3($this)) {
            ensureExtraCapacity($this, 1);
            continue retry;
          }
          var _unary__edvuaz = $this.length_1;
          $this.length_1 = _unary__edvuaz + 1 | 0;
          var putIndex = _unary__edvuaz;
          $this.keysArray_1[putIndex] = key;
          $this.presenceArray_1[putIndex] = hash_0;
          $this.hashArray_1[hash_0] = putIndex + 1 | 0;
          $this._size_1 = $this._size_1 + 1 | 0;
          registerModification($this);
          if (probeDistance > $this.maxProbeDistance_1)
            $this.maxProbeDistance_1 = probeDistance;
          return putIndex;
        }
        if (equals($this.keysArray_1[index - 1 | 0], key)) {
          return -index | 0;
        }
        probeDistance = probeDistance + 1 | 0;
        if (probeDistance > tentativeMaxProbeDistance) {
          rehash($this, imul(_get_hashSize__tftcho($this), 2));
          continue retry;
        }
        var _unary__edvuaz_0 = hash_0;
        hash_0 = _unary__edvuaz_0 - 1 | 0;
        if (_unary__edvuaz_0 === 0)
          hash_0 = _get_hashSize__tftcho($this) - 1 | 0;
      }
    }
  }
  function removeEntryAt($this, index) {
    resetAt($this.keysArray_1, index);
    var tmp0_safe_receiver = $this.valuesArray_1;
    if (tmp0_safe_receiver == null)
      null;
    else {
      resetAt(tmp0_safe_receiver, index);
    }
    removeHashAt($this, $this.presenceArray_1[index]);
    $this.presenceArray_1[index] = -1;
    $this._size_1 = $this._size_1 - 1 | 0;
    registerModification($this);
  }
  function removeHashAt($this, removedHash) {
    var hash_0 = removedHash;
    var hole = removedHash;
    var probeDistance = 0;
    while (true) {
      var _unary__edvuaz = hash_0;
      hash_0 = _unary__edvuaz - 1 | 0;
      if (_unary__edvuaz === 0)
        hash_0 = _get_hashSize__tftcho($this) - 1 | 0;
      var index = $this.hashArray_1[hash_0];
      probeDistance = probeDistance + 1 | 0;
      if (probeDistance > $this.maxProbeDistance_1) {
        $this.hashArray_1[hole] = 0;
        return Unit_instance;
      }
      if (index === 0) {
        $this.hashArray_1[hole] = 0;
        return Unit_instance;
      }
      var otherHash = hash($this, $this.keysArray_1[index - 1 | 0]);
      if (((otherHash - hash_0 | 0) & (_get_hashSize__tftcho($this) - 1 | 0)) >= probeDistance) {
        $this.hashArray_1[hole] = index;
        $this.presenceArray_1[index - 1 | 0] = hole;
        hole = hash_0;
        probeDistance = 0;
      }
    }
  }
  function contentEquals($this, other) {
    return $this._size_1 === other.get_size_woubt6_k$() && $this.containsAllEntries_m9iqdx_k$(other.get_entries_p20ztl_k$());
  }
  function putEntry($this, entry) {
    var index = addKey($this, entry.get_key_18j28a_k$());
    var valuesArray = allocateValuesArray($this);
    if (index >= 0) {
      valuesArray[index] = entry.get_value_j01efc_k$();
      return true;
    }
    var oldValue = valuesArray[(-index | 0) - 1 | 0];
    if (!equals(entry.get_value_j01efc_k$(), oldValue)) {
      valuesArray[(-index | 0) - 1 | 0] = entry.get_value_j01efc_k$();
      return true;
    }
    return false;
  }
  function putAllEntries($this, from) {
    if (from.isEmpty_y1axqb_k$())
      return false;
    ensureExtraCapacity($this, from.get_size_woubt6_k$());
    var it = from.iterator_jk1svi_k$();
    var updated = false;
    while (it.hasNext_bitz1p_k$()) {
      if (putEntry($this, it.next_20eer_k$()))
        updated = true;
    }
    return updated;
  }
  function Companion_3() {
    this.MAGIC_1 = -1640531527;
    this.INITIAL_CAPACITY_1 = 8;
    this.INITIAL_MAX_PROBE_DISTANCE_1 = 2;
    this.TOMBSTONE_1 = -1;
  }
  var Companion_instance_3;
  function Companion_getInstance_3() {
    return Companion_instance_3;
  }
  function Itr(map) {
    this.map_1 = map;
    this.index_1 = 0;
    this.lastIndex_1 = -1;
    this.expectedModCount_1 = this.map_1.modCount_1;
    this.initNext_evzkid_k$();
  }
  protoOf(Itr).initNext_evzkid_k$ = function () {
    while (this.index_1 < this.map_1.length_1 && this.map_1.presenceArray_1[this.index_1] < 0) {
      this.index_1 = this.index_1 + 1 | 0;
    }
  };
  protoOf(Itr).hasNext_bitz1p_k$ = function () {
    return this.index_1 < this.map_1.length_1;
  };
  protoOf(Itr).remove_ldkf9o_k$ = function () {
    this.checkForComodification_o4dljl_k$();
    // Inline function 'kotlin.check' call
    if (!!(this.lastIndex_1 === -1)) {
      var message = 'Call next() before removing element from the iterator.';
      throw IllegalStateException_init_$Create$_0(toString_1(message));
    }
    this.map_1.checkIsMutable_h5js84_k$();
    removeEntryAt(this.map_1, this.lastIndex_1);
    this.lastIndex_1 = -1;
    this.expectedModCount_1 = this.map_1.modCount_1;
  };
  protoOf(Itr).checkForComodification_o4dljl_k$ = function () {
    if (!(this.map_1.modCount_1 === this.expectedModCount_1))
      throw ConcurrentModificationException_init_$Create$();
  };
  function KeysItr(map) {
    Itr.call(this, map);
  }
  protoOf(KeysItr).next_20eer_k$ = function () {
    this.checkForComodification_o4dljl_k$();
    if (this.index_1 >= this.map_1.length_1)
      throw NoSuchElementException_init_$Create$();
    var tmp = this;
    var _unary__edvuaz = this.index_1;
    this.index_1 = _unary__edvuaz + 1 | 0;
    tmp.lastIndex_1 = _unary__edvuaz;
    var result = this.map_1.keysArray_1[this.lastIndex_1];
    this.initNext_evzkid_k$();
    return result;
  };
  function ValuesItr(map) {
    Itr.call(this, map);
  }
  protoOf(ValuesItr).next_20eer_k$ = function () {
    this.checkForComodification_o4dljl_k$();
    if (this.index_1 >= this.map_1.length_1)
      throw NoSuchElementException_init_$Create$();
    var tmp = this;
    var _unary__edvuaz = this.index_1;
    this.index_1 = _unary__edvuaz + 1 | 0;
    tmp.lastIndex_1 = _unary__edvuaz;
    var result = ensureNotNull(this.map_1.valuesArray_1)[this.lastIndex_1];
    this.initNext_evzkid_k$();
    return result;
  };
  function EntriesItr(map) {
    Itr.call(this, map);
  }
  protoOf(EntriesItr).next_20eer_k$ = function () {
    this.checkForComodification_o4dljl_k$();
    if (this.index_1 >= this.map_1.length_1)
      throw NoSuchElementException_init_$Create$();
    var tmp = this;
    var _unary__edvuaz = this.index_1;
    this.index_1 = _unary__edvuaz + 1 | 0;
    tmp.lastIndex_1 = _unary__edvuaz;
    var result = new EntryRef(this.map_1, this.lastIndex_1);
    this.initNext_evzkid_k$();
    return result;
  };
  protoOf(EntriesItr).nextHashCode_b13whm_k$ = function () {
    if (this.index_1 >= this.map_1.length_1)
      throw NoSuchElementException_init_$Create$();
    var tmp = this;
    var _unary__edvuaz = this.index_1;
    this.index_1 = _unary__edvuaz + 1 | 0;
    tmp.lastIndex_1 = _unary__edvuaz;
    // Inline function 'kotlin.hashCode' call
    var tmp0_safe_receiver = this.map_1.keysArray_1[this.lastIndex_1];
    var tmp1_elvis_lhs = tmp0_safe_receiver == null ? null : hashCode_0(tmp0_safe_receiver);
    var tmp_0 = tmp1_elvis_lhs == null ? 0 : tmp1_elvis_lhs;
    // Inline function 'kotlin.hashCode' call
    var tmp0_safe_receiver_0 = ensureNotNull(this.map_1.valuesArray_1)[this.lastIndex_1];
    var tmp1_elvis_lhs_0 = tmp0_safe_receiver_0 == null ? null : hashCode_0(tmp0_safe_receiver_0);
    var result = tmp_0 ^ (tmp1_elvis_lhs_0 == null ? 0 : tmp1_elvis_lhs_0);
    this.initNext_evzkid_k$();
    return result;
  };
  protoOf(EntriesItr).nextAppendString_konuli_k$ = function (sb) {
    if (this.index_1 >= this.map_1.length_1)
      throw NoSuchElementException_init_$Create$();
    var tmp = this;
    var _unary__edvuaz = this.index_1;
    this.index_1 = _unary__edvuaz + 1 | 0;
    tmp.lastIndex_1 = _unary__edvuaz;
    var key = this.map_1.keysArray_1[this.lastIndex_1];
    if (equals(key, this.map_1))
      sb.append_22ad7x_k$('(this Map)');
    else
      sb.append_t8pm91_k$(key);
    sb.append_58al37_k$(_Char___init__impl__6a9atx(61));
    var value = ensureNotNull(this.map_1.valuesArray_1)[this.lastIndex_1];
    if (equals(value, this.map_1))
      sb.append_22ad7x_k$('(this Map)');
    else
      sb.append_t8pm91_k$(value);
    this.initNext_evzkid_k$();
  };
  function EntryRef(map, index) {
    this.map_1 = map;
    this.index_1 = index;
    this.expectedModCount_1 = this.map_1.modCount_1;
  }
  protoOf(EntryRef).get_key_18j28a_k$ = function () {
    checkForComodification(this);
    return this.map_1.keysArray_1[this.index_1];
  };
  protoOf(EntryRef).get_value_j01efc_k$ = function () {
    checkForComodification(this);
    return ensureNotNull(this.map_1.valuesArray_1)[this.index_1];
  };
  protoOf(EntryRef).equals = function (other) {
    var tmp;
    var tmp_0;
    if (!(other == null) ? isInterface(other, Entry) : false) {
      tmp_0 = equals(other.get_key_18j28a_k$(), this.get_key_18j28a_k$());
    } else {
      tmp_0 = false;
    }
    if (tmp_0) {
      tmp = equals(other.get_value_j01efc_k$(), this.get_value_j01efc_k$());
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(EntryRef).hashCode = function () {
    // Inline function 'kotlin.hashCode' call
    var tmp0_safe_receiver = this.get_key_18j28a_k$();
    var tmp1_elvis_lhs = tmp0_safe_receiver == null ? null : hashCode_0(tmp0_safe_receiver);
    var tmp = tmp1_elvis_lhs == null ? 0 : tmp1_elvis_lhs;
    // Inline function 'kotlin.hashCode' call
    var tmp0_safe_receiver_0 = this.get_value_j01efc_k$();
    var tmp1_elvis_lhs_0 = tmp0_safe_receiver_0 == null ? null : hashCode_0(tmp0_safe_receiver_0);
    return tmp ^ (tmp1_elvis_lhs_0 == null ? 0 : tmp1_elvis_lhs_0);
  };
  protoOf(EntryRef).toString = function () {
    return toString_0(this.get_key_18j28a_k$()) + '=' + toString_0(this.get_value_j01efc_k$());
  };
  function InternalHashMap(keysArray, valuesArray, presenceArray, hashArray, maxProbeDistance, length) {
    this.keysArray_1 = keysArray;
    this.valuesArray_1 = valuesArray;
    this.presenceArray_1 = presenceArray;
    this.hashArray_1 = hashArray;
    this.maxProbeDistance_1 = maxProbeDistance;
    this.length_1 = length;
    this.hashShift_1 = computeShift(Companion_instance_3, _get_hashSize__tftcho(this));
    this.modCount_1 = 0;
    this._size_1 = 0;
    this.isReadOnly_1 = false;
  }
  protoOf(InternalHashMap).get_size_woubt6_k$ = function () {
    return this._size_1;
  };
  protoOf(InternalHashMap).containsValue_yf2ykl_k$ = function (value) {
    return findValue(this, value) >= 0;
  };
  protoOf(InternalHashMap).get_wei43m_k$ = function (key) {
    var index = findKey(this, key);
    if (index < 0)
      return null;
    return ensureNotNull(this.valuesArray_1)[index];
  };
  protoOf(InternalHashMap).contains_vbgn2f_k$ = function (key) {
    return findKey(this, key) >= 0;
  };
  protoOf(InternalHashMap).put_4fpzoq_k$ = function (key, value) {
    var index = addKey(this, key);
    var valuesArray = allocateValuesArray(this);
    if (index < 0) {
      var oldValue = valuesArray[(-index | 0) - 1 | 0];
      valuesArray[(-index | 0) - 1 | 0] = value;
      return oldValue;
    } else {
      valuesArray[index] = value;
      return null;
    }
  };
  protoOf(InternalHashMap).putAll_wgg6cj_k$ = function (from) {
    this.checkIsMutable_h5js84_k$();
    putAllEntries(this, from.get_entries_p20ztl_k$());
  };
  protoOf(InternalHashMap).remove_gppy8k_k$ = function (key) {
    this.checkIsMutable_h5js84_k$();
    var index = findKey(this, key);
    if (index < 0)
      return null;
    var oldValue = ensureNotNull(this.valuesArray_1)[index];
    removeEntryAt(this, index);
    return oldValue;
  };
  protoOf(InternalHashMap).clear_j9egeb_k$ = function () {
    this.checkIsMutable_h5js84_k$();
    var inductionVariable = 0;
    var last = this.length_1 - 1 | 0;
    if (inductionVariable <= last)
      do {
        var i = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        var hash = this.presenceArray_1[i];
        if (hash >= 0) {
          this.hashArray_1[hash] = 0;
          this.presenceArray_1[i] = -1;
        }
      }
       while (!(i === last));
    resetRange(this.keysArray_1, 0, this.length_1);
    var tmp0_safe_receiver = this.valuesArray_1;
    if (tmp0_safe_receiver == null)
      null;
    else {
      resetRange(tmp0_safe_receiver, 0, this.length_1);
    }
    this._size_1 = 0;
    this.length_1 = 0;
    registerModification(this);
  };
  protoOf(InternalHashMap).equals = function (other) {
    var tmp;
    if (other === this) {
      tmp = true;
    } else {
      var tmp_0;
      if (!(other == null) ? isInterface(other, KtMap) : false) {
        tmp_0 = contentEquals(this, other);
      } else {
        tmp_0 = false;
      }
      tmp = tmp_0;
    }
    return tmp;
  };
  protoOf(InternalHashMap).hashCode = function () {
    var result = 0;
    var it = this.entriesIterator_or017i_k$();
    while (it.hasNext_bitz1p_k$()) {
      result = result + it.nextHashCode_b13whm_k$() | 0;
    }
    return result;
  };
  protoOf(InternalHashMap).toString = function () {
    var sb = StringBuilder_init_$Create$(2 + imul(this._size_1, 3) | 0);
    sb.append_22ad7x_k$('{');
    var i = 0;
    var it = this.entriesIterator_or017i_k$();
    while (it.hasNext_bitz1p_k$()) {
      if (i > 0) {
        sb.append_22ad7x_k$(', ');
      }
      it.nextAppendString_konuli_k$(sb);
      i = i + 1 | 0;
    }
    sb.append_22ad7x_k$('}');
    return sb.toString();
  };
  protoOf(InternalHashMap).checkIsMutable_h5js84_k$ = function () {
    if (this.isReadOnly_1)
      throw UnsupportedOperationException_init_$Create$();
  };
  protoOf(InternalHashMap).containsEntry_jg6xfi_k$ = function (entry) {
    var index = findKey(this, entry.get_key_18j28a_k$());
    if (index < 0)
      return false;
    return equals(ensureNotNull(this.valuesArray_1)[index], entry.get_value_j01efc_k$());
  };
  protoOf(InternalHashMap).containsOtherEntry_yvdc55_k$ = function (entry) {
    return this.containsEntry_jg6xfi_k$(isInterface(entry, Entry) ? entry : THROW_CCE());
  };
  protoOf(InternalHashMap).keysIterator_mjslfm_k$ = function () {
    return new KeysItr(this);
  };
  protoOf(InternalHashMap).valuesIterator_3ptos0_k$ = function () {
    return new ValuesItr(this);
  };
  protoOf(InternalHashMap).entriesIterator_or017i_k$ = function () {
    return new EntriesItr(this);
  };
  function InternalMap() {
  }
  function LinkedHashMap_init_$Init$($this) {
    HashMap_init_$Init$_0($this);
    LinkedHashMap.call($this);
    return $this;
  }
  function LinkedHashMap_init_$Create$() {
    return LinkedHashMap_init_$Init$(objectCreate(protoOf(LinkedHashMap)));
  }
  function LinkedHashMap_init_$Init$_0(initialCapacity, $this) {
    HashMap_init_$Init$_2(initialCapacity, $this);
    LinkedHashMap.call($this);
    return $this;
  }
  function LinkedHashMap_init_$Create$_0(initialCapacity) {
    return LinkedHashMap_init_$Init$_0(initialCapacity, objectCreate(protoOf(LinkedHashMap)));
  }
  function LinkedHashMap_init_$Init$_1(original, $this) {
    HashMap_init_$Init$_3(original, $this);
    LinkedHashMap.call($this);
    return $this;
  }
  function LinkedHashMap_init_$Create$_1(original) {
    return LinkedHashMap_init_$Init$_1(original, objectCreate(protoOf(LinkedHashMap)));
  }
  protoOf(LinkedHashMap).checkIsMutable_jn1ih0_k$ = function () {
    return this.internalMap_1.checkIsMutable_h5js84_k$();
  };
  function LinkedHashMap() {
  }
  function LinkedHashSet_init_$Init$($this) {
    HashSet_init_$Init$_0($this);
    LinkedHashSet.call($this);
    return $this;
  }
  function LinkedHashSet_init_$Create$() {
    return LinkedHashSet_init_$Init$(objectCreate(protoOf(LinkedHashSet)));
  }
  function LinkedHashSet_init_$Init$_0(elements, $this) {
    HashSet_init_$Init$_1(elements, $this);
    LinkedHashSet.call($this);
    return $this;
  }
  function LinkedHashSet_init_$Create$_0(elements) {
    return LinkedHashSet_init_$Init$_0(elements, objectCreate(protoOf(LinkedHashSet)));
  }
  function LinkedHashSet_init_$Init$_1(initialCapacity, loadFactor, $this) {
    HashSet_init_$Init$_2(initialCapacity, loadFactor, $this);
    LinkedHashSet.call($this);
    return $this;
  }
  function LinkedHashSet_init_$Init$_2(initialCapacity, $this) {
    LinkedHashSet_init_$Init$_1(initialCapacity, 1.0, $this);
    return $this;
  }
  function LinkedHashSet_init_$Create$_1(initialCapacity) {
    return LinkedHashSet_init_$Init$_2(initialCapacity, objectCreate(protoOf(LinkedHashSet)));
  }
  protoOf(LinkedHashSet).checkIsMutable_jn1ih0_k$ = function () {
    return this.internalMap_1.checkIsMutable_h5js84_k$();
  };
  function LinkedHashSet() {
  }
  function RandomAccess() {
  }
  function UnsupportedOperationException_init_$Init$($this) {
    RuntimeException_init_$Init$($this);
    UnsupportedOperationException.call($this);
    return $this;
  }
  function UnsupportedOperationException_init_$Create$() {
    var tmp = UnsupportedOperationException_init_$Init$(objectCreate(protoOf(UnsupportedOperationException)));
    captureStack(tmp, UnsupportedOperationException_init_$Create$);
    return tmp;
  }
  function UnsupportedOperationException_init_$Init$_0(message, $this) {
    RuntimeException_init_$Init$_0(message, $this);
    UnsupportedOperationException.call($this);
    return $this;
  }
  function UnsupportedOperationException_init_$Create$_0(message) {
    var tmp = UnsupportedOperationException_init_$Init$_0(message, objectCreate(protoOf(UnsupportedOperationException)));
    captureStack(tmp, UnsupportedOperationException_init_$Create$_0);
    return tmp;
  }
  function UnsupportedOperationException() {
    captureStack(this, UnsupportedOperationException);
  }
  function IllegalArgumentException_init_$Init$($this) {
    RuntimeException_init_$Init$($this);
    IllegalArgumentException.call($this);
    return $this;
  }
  function IllegalArgumentException_init_$Create$() {
    var tmp = IllegalArgumentException_init_$Init$(objectCreate(protoOf(IllegalArgumentException)));
    captureStack(tmp, IllegalArgumentException_init_$Create$);
    return tmp;
  }
  function IllegalArgumentException_init_$Init$_0(message, $this) {
    RuntimeException_init_$Init$_0(message, $this);
    IllegalArgumentException.call($this);
    return $this;
  }
  function IllegalArgumentException_init_$Create$_0(message) {
    var tmp = IllegalArgumentException_init_$Init$_0(message, objectCreate(protoOf(IllegalArgumentException)));
    captureStack(tmp, IllegalArgumentException_init_$Create$_0);
    return tmp;
  }
  function IllegalArgumentException() {
    captureStack(this, IllegalArgumentException);
  }
  function RuntimeException_init_$Init$($this) {
    Exception_init_$Init$($this);
    RuntimeException.call($this);
    return $this;
  }
  function RuntimeException_init_$Create$() {
    var tmp = RuntimeException_init_$Init$(objectCreate(protoOf(RuntimeException)));
    captureStack(tmp, RuntimeException_init_$Create$);
    return tmp;
  }
  function RuntimeException_init_$Init$_0(message, $this) {
    Exception_init_$Init$_0(message, $this);
    RuntimeException.call($this);
    return $this;
  }
  function RuntimeException_init_$Create$_0(message) {
    var tmp = RuntimeException_init_$Init$_0(message, objectCreate(protoOf(RuntimeException)));
    captureStack(tmp, RuntimeException_init_$Create$_0);
    return tmp;
  }
  function RuntimeException() {
    captureStack(this, RuntimeException);
  }
  function Exception_init_$Init$($this) {
    extendThrowable($this);
    Exception.call($this);
    return $this;
  }
  function Exception_init_$Create$() {
    var tmp = Exception_init_$Init$(objectCreate(protoOf(Exception)));
    captureStack(tmp, Exception_init_$Create$);
    return tmp;
  }
  function Exception_init_$Init$_0(message, $this) {
    extendThrowable($this, message);
    Exception.call($this);
    return $this;
  }
  function Exception_init_$Create$_0(message) {
    var tmp = Exception_init_$Init$_0(message, objectCreate(protoOf(Exception)));
    captureStack(tmp, Exception_init_$Create$_0);
    return tmp;
  }
  function Exception() {
    captureStack(this, Exception);
  }
  function NoSuchElementException_init_$Init$($this) {
    RuntimeException_init_$Init$($this);
    NoSuchElementException.call($this);
    return $this;
  }
  function NoSuchElementException_init_$Create$() {
    var tmp = NoSuchElementException_init_$Init$(objectCreate(protoOf(NoSuchElementException)));
    captureStack(tmp, NoSuchElementException_init_$Create$);
    return tmp;
  }
  function NoSuchElementException_init_$Init$_0(message, $this) {
    RuntimeException_init_$Init$_0(message, $this);
    NoSuchElementException.call($this);
    return $this;
  }
  function NoSuchElementException_init_$Create$_0(message) {
    var tmp = NoSuchElementException_init_$Init$_0(message, objectCreate(protoOf(NoSuchElementException)));
    captureStack(tmp, NoSuchElementException_init_$Create$_0);
    return tmp;
  }
  function NoSuchElementException() {
    captureStack(this, NoSuchElementException);
  }
  function IndexOutOfBoundsException_init_$Init$($this) {
    RuntimeException_init_$Init$($this);
    IndexOutOfBoundsException.call($this);
    return $this;
  }
  function IndexOutOfBoundsException_init_$Create$() {
    var tmp = IndexOutOfBoundsException_init_$Init$(objectCreate(protoOf(IndexOutOfBoundsException)));
    captureStack(tmp, IndexOutOfBoundsException_init_$Create$);
    return tmp;
  }
  function IndexOutOfBoundsException_init_$Init$_0(message, $this) {
    RuntimeException_init_$Init$_0(message, $this);
    IndexOutOfBoundsException.call($this);
    return $this;
  }
  function IndexOutOfBoundsException_init_$Create$_0(message) {
    var tmp = IndexOutOfBoundsException_init_$Init$_0(message, objectCreate(protoOf(IndexOutOfBoundsException)));
    captureStack(tmp, IndexOutOfBoundsException_init_$Create$_0);
    return tmp;
  }
  function IndexOutOfBoundsException() {
    captureStack(this, IndexOutOfBoundsException);
  }
  function IllegalStateException_init_$Init$($this) {
    RuntimeException_init_$Init$($this);
    IllegalStateException.call($this);
    return $this;
  }
  function IllegalStateException_init_$Create$() {
    var tmp = IllegalStateException_init_$Init$(objectCreate(protoOf(IllegalStateException)));
    captureStack(tmp, IllegalStateException_init_$Create$);
    return tmp;
  }
  function IllegalStateException_init_$Init$_0(message, $this) {
    RuntimeException_init_$Init$_0(message, $this);
    IllegalStateException.call($this);
    return $this;
  }
  function IllegalStateException_init_$Create$_0(message) {
    var tmp = IllegalStateException_init_$Init$_0(message, objectCreate(protoOf(IllegalStateException)));
    captureStack(tmp, IllegalStateException_init_$Create$_0);
    return tmp;
  }
  function IllegalStateException() {
    captureStack(this, IllegalStateException);
  }
  function ConcurrentModificationException_init_$Init$($this) {
    RuntimeException_init_$Init$($this);
    ConcurrentModificationException.call($this);
    return $this;
  }
  function ConcurrentModificationException_init_$Create$() {
    var tmp = ConcurrentModificationException_init_$Init$(objectCreate(protoOf(ConcurrentModificationException)));
    captureStack(tmp, ConcurrentModificationException_init_$Create$);
    return tmp;
  }
  function ConcurrentModificationException_init_$Init$_0(message, $this) {
    RuntimeException_init_$Init$_0(message, $this);
    ConcurrentModificationException.call($this);
    return $this;
  }
  function ConcurrentModificationException_init_$Create$_0(message) {
    var tmp = ConcurrentModificationException_init_$Init$_0(message, objectCreate(protoOf(ConcurrentModificationException)));
    captureStack(tmp, ConcurrentModificationException_init_$Create$_0);
    return tmp;
  }
  function ConcurrentModificationException() {
    captureStack(this, ConcurrentModificationException);
  }
  function ArithmeticException_init_$Init$($this) {
    RuntimeException_init_$Init$($this);
    ArithmeticException.call($this);
    return $this;
  }
  function ArithmeticException_init_$Create$() {
    var tmp = ArithmeticException_init_$Init$(objectCreate(protoOf(ArithmeticException)));
    captureStack(tmp, ArithmeticException_init_$Create$);
    return tmp;
  }
  function ArithmeticException_init_$Init$_0(message, $this) {
    RuntimeException_init_$Init$_0(message, $this);
    ArithmeticException.call($this);
    return $this;
  }
  function ArithmeticException_init_$Create$_0(message) {
    var tmp = ArithmeticException_init_$Init$_0(message, objectCreate(protoOf(ArithmeticException)));
    captureStack(tmp, ArithmeticException_init_$Create$_0);
    return tmp;
  }
  function ArithmeticException() {
    captureStack(this, ArithmeticException);
  }
  function NumberFormatException_init_$Init$($this) {
    IllegalArgumentException_init_$Init$($this);
    NumberFormatException.call($this);
    return $this;
  }
  function NumberFormatException_init_$Create$() {
    var tmp = NumberFormatException_init_$Init$(objectCreate(protoOf(NumberFormatException)));
    captureStack(tmp, NumberFormatException_init_$Create$);
    return tmp;
  }
  function NumberFormatException_init_$Init$_0(message, $this) {
    IllegalArgumentException_init_$Init$_0(message, $this);
    NumberFormatException.call($this);
    return $this;
  }
  function NumberFormatException_init_$Create$_0(message) {
    var tmp = NumberFormatException_init_$Init$_0(message, objectCreate(protoOf(NumberFormatException)));
    captureStack(tmp, NumberFormatException_init_$Create$_0);
    return tmp;
  }
  function NumberFormatException() {
    captureStack(this, NumberFormatException);
  }
  function NoWhenBranchMatchedException_init_$Init$($this) {
    RuntimeException_init_$Init$($this);
    NoWhenBranchMatchedException.call($this);
    return $this;
  }
  function NoWhenBranchMatchedException_init_$Create$() {
    var tmp = NoWhenBranchMatchedException_init_$Init$(objectCreate(protoOf(NoWhenBranchMatchedException)));
    captureStack(tmp, NoWhenBranchMatchedException_init_$Create$);
    return tmp;
  }
  function NoWhenBranchMatchedException() {
    captureStack(this, NoWhenBranchMatchedException);
  }
  function NullPointerException_init_$Init$($this) {
    RuntimeException_init_$Init$($this);
    NullPointerException.call($this);
    return $this;
  }
  function NullPointerException_init_$Create$() {
    var tmp = NullPointerException_init_$Init$(objectCreate(protoOf(NullPointerException)));
    captureStack(tmp, NullPointerException_init_$Create$);
    return tmp;
  }
  function NullPointerException() {
    captureStack(this, NullPointerException);
  }
  function ClassCastException_init_$Init$($this) {
    RuntimeException_init_$Init$($this);
    ClassCastException.call($this);
    return $this;
  }
  function ClassCastException_init_$Create$() {
    var tmp = ClassCastException_init_$Init$(objectCreate(protoOf(ClassCastException)));
    captureStack(tmp, ClassCastException_init_$Create$);
    return tmp;
  }
  function ClassCastException() {
    captureStack(this, ClassCastException);
  }
  function fillFrom(src, dst) {
    var srcLen = src.length;
    var dstLen = dst.length;
    var index = 0;
    // Inline function 'kotlin.js.unsafeCast' call
    var arr = dst;
    while (index < srcLen && index < dstLen) {
      var tmp = index;
      var _unary__edvuaz = index;
      index = _unary__edvuaz + 1 | 0;
      arr[tmp] = src[_unary__edvuaz];
    }
    return dst;
  }
  function arrayCopyResize(source, newSize, defaultValue) {
    // Inline function 'kotlin.js.unsafeCast' call
    var result = source.slice(0, newSize);
    // Inline function 'kotlin.copyArrayType' call
    if (source.$type$ !== undefined) {
      result.$type$ = source.$type$;
    }
    var index = source.length;
    if (newSize > index) {
      // Inline function 'kotlin.js.asDynamic' call
      result.length = newSize;
      while (index < newSize) {
        var _unary__edvuaz = index;
        index = _unary__edvuaz + 1 | 0;
        result[_unary__edvuaz] = defaultValue;
      }
    }
    return result;
  }
  function lazy(initializer) {
    return new UnsafeLazyImpl(initializer);
  }
  function PrimitiveKClassImpl(jClass, simpleName, isInstanceFunction) {
    KClassImpl.call(this);
    this.jClass_1 = jClass;
    this.simpleName_1 = simpleName;
    this.isInstanceFunction_1 = isInstanceFunction;
  }
  protoOf(PrimitiveKClassImpl).get_jClass_i6cf5d_k$ = function () {
    return this.jClass_1;
  };
  protoOf(PrimitiveKClassImpl).get_simpleName_r6f8py_k$ = function () {
    return this.simpleName_1;
  };
  function KClassImpl() {
  }
  protoOf(KClassImpl).equals = function (other) {
    var tmp;
    if (other instanceof NothingKClassImpl) {
      tmp = false;
    } else {
      if (other instanceof KClassImpl) {
        tmp = (equals(this.get_jClass_i6cf5d_k$(), other.get_jClass_i6cf5d_k$()) && this.get_simpleName_r6f8py_k$() == other.get_simpleName_r6f8py_k$());
      } else {
        tmp = false;
      }
    }
    return tmp;
  };
  protoOf(KClassImpl).hashCode = function () {
    var tmp0_safe_receiver = this.get_simpleName_r6f8py_k$();
    var tmp1_elvis_lhs = tmp0_safe_receiver == null ? null : getStringHashCode(tmp0_safe_receiver);
    return tmp1_elvis_lhs == null ? 0 : tmp1_elvis_lhs;
  };
  protoOf(KClassImpl).toString = function () {
    return 'class ' + this.get_simpleName_r6f8py_k$();
  };
  function NothingKClassImpl() {
  }
  function KProperty0() {
  }
  function CharacterCodingException_init_$Init$($this) {
    CharacterCodingException.call($this, null);
    return $this;
  }
  function CharacterCodingException_init_$Create$() {
    var tmp = CharacterCodingException_init_$Init$(objectCreate(protoOf(CharacterCodingException)));
    captureStack(tmp, CharacterCodingException_init_$Create$);
    return tmp;
  }
  function CharacterCodingException(message) {
    Exception_init_$Init$_0(message, this);
    captureStack(this, CharacterCodingException);
  }
  function StringBuilder_init_$Init$(capacity, $this) {
    StringBuilder_init_$Init$_0($this);
    return $this;
  }
  function StringBuilder_init_$Create$(capacity) {
    return StringBuilder_init_$Init$(capacity, objectCreate(protoOf(StringBuilder)));
  }
  function StringBuilder_init_$Init$_0($this) {
    StringBuilder.call($this, '');
    return $this;
  }
  function StringBuilder_init_$Create$_0() {
    return StringBuilder_init_$Init$_0(objectCreate(protoOf(StringBuilder)));
  }
  function StringBuilder(content) {
    this.string_1 = content;
  }
  protoOf(StringBuilder).get_length_g42xv3_k$ = function () {
    // Inline function 'kotlin.js.asDynamic' call
    return this.string_1.length;
  };
  protoOf(StringBuilder).get_kdzpvg_k$ = function (index) {
    // Inline function 'kotlin.text.getOrElse' call
    var this_0 = this.string_1;
    var tmp;
    if (0 <= index ? index <= (charSequenceLength(this_0) - 1 | 0) : false) {
      tmp = charSequenceGet(this_0, index);
    } else {
      throw IndexOutOfBoundsException_init_$Create$_0('index: ' + index + ', length: ' + this.get_length_g42xv3_k$() + '}');
    }
    return tmp;
  };
  protoOf(StringBuilder).subSequence_hm5hnj_k$ = function (startIndex, endIndex) {
    return substring(this.string_1, startIndex, endIndex);
  };
  protoOf(StringBuilder).append_58al37_k$ = function (value) {
    this.string_1 = this.string_1 + toString(value);
    return this;
  };
  protoOf(StringBuilder).append_jgojdo_k$ = function (value) {
    this.string_1 = this.string_1 + toString_0(value);
    return this;
  };
  protoOf(StringBuilder).append_t8pm91_k$ = function (value) {
    this.string_1 = this.string_1 + toString_0(value);
    return this;
  };
  protoOf(StringBuilder).append_22ad7x_k$ = function (value) {
    var tmp = this;
    var tmp_0 = this.string_1;
    tmp.string_1 = tmp_0 + (value == null ? 'null' : value);
    return this;
  };
  protoOf(StringBuilder).toString = function () {
    return this.string_1;
  };
  protoOf(StringBuilder).clear_1keqml_k$ = function () {
    this.string_1 = '';
    return this;
  };
  function uppercaseChar(_this__u8e3s4) {
    // Inline function 'kotlin.text.uppercase' call
    // Inline function 'kotlin.js.asDynamic' call
    // Inline function 'kotlin.js.unsafeCast' call
    var uppercase = toString(_this__u8e3s4).toUpperCase();
    return uppercase.length > 1 ? _this__u8e3s4 : charCodeAt(uppercase, 0);
  }
  function isWhitespace(_this__u8e3s4) {
    return isWhitespaceImpl(_this__u8e3s4);
  }
  function checkRadix(radix) {
    if (!(2 <= radix ? radix <= 36 : false)) {
      throw IllegalArgumentException_init_$Create$_0('radix ' + radix + ' was not in valid range 2..36');
    }
    return radix;
  }
  function toDoubleOrNull(_this__u8e3s4) {
    // Inline function 'kotlin.js.asDynamic' call
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.takeIf' call
    var this_0 = +_this__u8e3s4;
    var tmp;
    if (!(isNaN_0(this_0) && !isNaN_1(_this__u8e3s4) || (this_0 === 0.0 && isBlank(_this__u8e3s4)))) {
      tmp = this_0;
    } else {
      tmp = null;
    }
    return tmp;
  }
  function toInt(_this__u8e3s4) {
    var tmp0_elvis_lhs = toIntOrNull(_this__u8e3s4);
    var tmp;
    if (tmp0_elvis_lhs == null) {
      numberFormatError(_this__u8e3s4);
    } else {
      tmp = tmp0_elvis_lhs;
    }
    return tmp;
  }
  function toDouble(_this__u8e3s4) {
    // Inline function 'kotlin.js.asDynamic' call
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.also' call
    var this_0 = +_this__u8e3s4;
    if (isNaN_0(this_0) && !isNaN_1(_this__u8e3s4) || (this_0 === 0.0 && isBlank(_this__u8e3s4))) {
      numberFormatError(_this__u8e3s4);
    }
    return this_0;
  }
  function isNaN_1(_this__u8e3s4) {
    // Inline function 'kotlin.text.lowercase' call
    // Inline function 'kotlin.js.asDynamic' call
    switch (_this__u8e3s4.toLowerCase()) {
      case 'nan':
      case '+nan':
      case '-nan':
        return true;
      default:
        return false;
    }
  }
  function digitOf(char, radix) {
    // Inline function 'kotlin.let' call
    var it = Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(48)) >= 0 && Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(57)) <= 0 ? Char__minus_impl_a2frrh(char, _Char___init__impl__6a9atx(48)) : Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(65)) >= 0 && Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(90)) <= 0 ? Char__minus_impl_a2frrh(char, _Char___init__impl__6a9atx(65)) + 10 | 0 : Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(97)) >= 0 && Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(122)) <= 0 ? Char__minus_impl_a2frrh(char, _Char___init__impl__6a9atx(97)) + 10 | 0 : Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(128)) < 0 ? -1 : Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(65313)) >= 0 && Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(65338)) <= 0 ? Char__minus_impl_a2frrh(char, _Char___init__impl__6a9atx(65313)) + 10 | 0 : Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(65345)) >= 0 && Char__compareTo_impl_ypi4mb(char, _Char___init__impl__6a9atx(65370)) <= 0 ? Char__minus_impl_a2frrh(char, _Char___init__impl__6a9atx(65345)) + 10 | 0 : digitToIntImpl(char);
    return it >= radix ? -1 : it;
  }
  var STRING_CASE_INSENSITIVE_ORDER;
  function substring(_this__u8e3s4, startIndex, endIndex) {
    _init_properties_stringJs_kt__bg7zye();
    // Inline function 'kotlin.js.asDynamic' call
    return _this__u8e3s4.substring(startIndex, endIndex);
  }
  function substring_0(_this__u8e3s4, startIndex) {
    _init_properties_stringJs_kt__bg7zye();
    // Inline function 'kotlin.js.asDynamic' call
    return _this__u8e3s4.substring(startIndex);
  }
  function compareTo_0(_this__u8e3s4, other, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    _init_properties_stringJs_kt__bg7zye();
    if (ignoreCase) {
      var n1 = _this__u8e3s4.length;
      var n2 = other.length;
      // Inline function 'kotlin.comparisons.minOf' call
      var min = Math.min(n1, n2);
      if (min === 0)
        return n1 - n2 | 0;
      var inductionVariable = 0;
      if (inductionVariable < min)
        do {
          var index = inductionVariable;
          inductionVariable = inductionVariable + 1 | 0;
          var thisChar = charCodeAt(_this__u8e3s4, index);
          var otherChar = charCodeAt(other, index);
          if (!(thisChar === otherChar)) {
            thisChar = uppercaseChar(thisChar);
            otherChar = uppercaseChar(otherChar);
            if (!(thisChar === otherChar)) {
              // Inline function 'kotlin.text.lowercaseChar' call
              // Inline function 'kotlin.text.lowercase' call
              var this_0 = thisChar;
              // Inline function 'kotlin.js.asDynamic' call
              // Inline function 'kotlin.js.unsafeCast' call
              var tmp$ret$2 = toString(this_0).toLowerCase();
              thisChar = charCodeAt(tmp$ret$2, 0);
              // Inline function 'kotlin.text.lowercaseChar' call
              // Inline function 'kotlin.text.lowercase' call
              var this_1 = otherChar;
              // Inline function 'kotlin.js.asDynamic' call
              // Inline function 'kotlin.js.unsafeCast' call
              var tmp$ret$6 = toString(this_1).toLowerCase();
              otherChar = charCodeAt(tmp$ret$6, 0);
              if (!(thisChar === otherChar)) {
                return Char__compareTo_impl_ypi4mb(thisChar, otherChar);
              }
            }
          }
        }
         while (inductionVariable < min);
      return n1 - n2 | 0;
    } else {
      return compareTo(_this__u8e3s4, other);
    }
  }
  function encodeToByteArray(_this__u8e3s4) {
    _init_properties_stringJs_kt__bg7zye();
    return encodeUtf8(_this__u8e3s4, 0, _this__u8e3s4.length, false);
  }
  function sam$kotlin_Comparator$0(function_0) {
    this.function_1 = function_0;
  }
  protoOf(sam$kotlin_Comparator$0).compare_bczr_k$ = function (a, b) {
    return this.function_1(a, b);
  };
  protoOf(sam$kotlin_Comparator$0).compare = function (a, b) {
    return this.compare_bczr_k$(a, b);
  };
  protoOf(sam$kotlin_Comparator$0).getFunctionDelegate_jtodtf_k$ = function () {
    return this.function_1;
  };
  protoOf(sam$kotlin_Comparator$0).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, Comparator) : false) {
      var tmp_0;
      if (!(other == null) ? isInterface(other, FunctionAdapter) : false) {
        tmp_0 = equals(this.getFunctionDelegate_jtodtf_k$(), other.getFunctionDelegate_jtodtf_k$());
      } else {
        tmp_0 = false;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(sam$kotlin_Comparator$0).hashCode = function () {
    return hashCode_0(this.getFunctionDelegate_jtodtf_k$());
  };
  function STRING_CASE_INSENSITIVE_ORDER$lambda(a, b) {
    _init_properties_stringJs_kt__bg7zye();
    return compareTo_0(a, b, true);
  }
  var properties_initialized_stringJs_kt_nta8o4;
  function _init_properties_stringJs_kt__bg7zye() {
    if (!properties_initialized_stringJs_kt_nta8o4) {
      properties_initialized_stringJs_kt_nta8o4 = true;
      var tmp = STRING_CASE_INSENSITIVE_ORDER$lambda;
      STRING_CASE_INSENSITIVE_ORDER = new sam$kotlin_Comparator$0(tmp);
    }
  }
  function equals_0(_this__u8e3s4, other, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    if (_this__u8e3s4 == null)
      return other == null;
    if (other == null)
      return false;
    if (!ignoreCase)
      return _this__u8e3s4 == other;
    if (!(_this__u8e3s4.length === other.length))
      return false;
    var inductionVariable = 0;
    var last = _this__u8e3s4.length;
    if (inductionVariable < last)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        var thisChar = charCodeAt(_this__u8e3s4, index);
        var otherChar = charCodeAt(other, index);
        if (!equals_1(thisChar, otherChar, ignoreCase)) {
          return false;
        }
      }
       while (inductionVariable < last);
    return true;
  }
  function startsWith(_this__u8e3s4, prefix, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    if (!ignoreCase) {
      // Inline function 'kotlin.text.nativeStartsWith' call
      // Inline function 'kotlin.js.asDynamic' call
      return _this__u8e3s4.startsWith(prefix, 0);
    } else
      return regionMatches(_this__u8e3s4, 0, prefix, 0, prefix.length, ignoreCase);
  }
  function endsWith(_this__u8e3s4, suffix, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    if (!ignoreCase) {
      // Inline function 'kotlin.text.nativeEndsWith' call
      // Inline function 'kotlin.js.asDynamic' call
      return _this__u8e3s4.endsWith(suffix);
    } else
      return regionMatches(_this__u8e3s4, _this__u8e3s4.length - suffix.length | 0, suffix, 0, suffix.length, ignoreCase);
  }
  function regionMatches(_this__u8e3s4, thisOffset, other, otherOffset, length, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    return regionMatchesImpl(_this__u8e3s4, thisOffset, other, otherOffset, length, ignoreCase);
  }
  function get_REPLACEMENT_BYTE_SEQUENCE() {
    _init_properties_utf8Encoding_kt__9thjs4();
    return REPLACEMENT_BYTE_SEQUENCE;
  }
  var REPLACEMENT_BYTE_SEQUENCE;
  function encodeUtf8(string, startIndex, endIndex, throwOnMalformed) {
    _init_properties_utf8Encoding_kt__9thjs4();
    // Inline function 'kotlin.require' call
    // Inline function 'kotlin.require' call
    if (!(startIndex >= 0 && endIndex <= string.length && startIndex <= endIndex)) {
      var message = 'Failed requirement.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    var bytes = new Int8Array(imul(endIndex - startIndex | 0, 3));
    var byteIndex = 0;
    var charIndex = startIndex;
    while (charIndex < endIndex) {
      var _unary__edvuaz = charIndex;
      charIndex = _unary__edvuaz + 1 | 0;
      // Inline function 'kotlin.code' call
      var this_0 = charCodeAt(string, _unary__edvuaz);
      var code = Char__toInt_impl_vasixd(this_0);
      if (code < 128) {
        var _unary__edvuaz_0 = byteIndex;
        byteIndex = _unary__edvuaz_0 + 1 | 0;
        bytes[_unary__edvuaz_0] = toByte(code);
      } else if (code < 2048) {
        var _unary__edvuaz_1 = byteIndex;
        byteIndex = _unary__edvuaz_1 + 1 | 0;
        bytes[_unary__edvuaz_1] = toByte(code >> 6 | 192);
        var _unary__edvuaz_2 = byteIndex;
        byteIndex = _unary__edvuaz_2 + 1 | 0;
        bytes[_unary__edvuaz_2] = toByte(code & 63 | 128);
      } else if (code < 55296 || code >= 57344) {
        var _unary__edvuaz_3 = byteIndex;
        byteIndex = _unary__edvuaz_3 + 1 | 0;
        bytes[_unary__edvuaz_3] = toByte(code >> 12 | 224);
        var _unary__edvuaz_4 = byteIndex;
        byteIndex = _unary__edvuaz_4 + 1 | 0;
        bytes[_unary__edvuaz_4] = toByte(code >> 6 & 63 | 128);
        var _unary__edvuaz_5 = byteIndex;
        byteIndex = _unary__edvuaz_5 + 1 | 0;
        bytes[_unary__edvuaz_5] = toByte(code & 63 | 128);
      } else {
        var codePoint = codePointFromSurrogate(string, code, charIndex, endIndex, throwOnMalformed);
        if (codePoint <= 0) {
          var _unary__edvuaz_6 = byteIndex;
          byteIndex = _unary__edvuaz_6 + 1 | 0;
          bytes[_unary__edvuaz_6] = get_REPLACEMENT_BYTE_SEQUENCE()[0];
          var _unary__edvuaz_7 = byteIndex;
          byteIndex = _unary__edvuaz_7 + 1 | 0;
          bytes[_unary__edvuaz_7] = get_REPLACEMENT_BYTE_SEQUENCE()[1];
          var _unary__edvuaz_8 = byteIndex;
          byteIndex = _unary__edvuaz_8 + 1 | 0;
          bytes[_unary__edvuaz_8] = get_REPLACEMENT_BYTE_SEQUENCE()[2];
        } else {
          var _unary__edvuaz_9 = byteIndex;
          byteIndex = _unary__edvuaz_9 + 1 | 0;
          bytes[_unary__edvuaz_9] = toByte(codePoint >> 18 | 240);
          var _unary__edvuaz_10 = byteIndex;
          byteIndex = _unary__edvuaz_10 + 1 | 0;
          bytes[_unary__edvuaz_10] = toByte(codePoint >> 12 & 63 | 128);
          var _unary__edvuaz_11 = byteIndex;
          byteIndex = _unary__edvuaz_11 + 1 | 0;
          bytes[_unary__edvuaz_11] = toByte(codePoint >> 6 & 63 | 128);
          var _unary__edvuaz_12 = byteIndex;
          byteIndex = _unary__edvuaz_12 + 1 | 0;
          bytes[_unary__edvuaz_12] = toByte(codePoint & 63 | 128);
          charIndex = charIndex + 1 | 0;
        }
      }
    }
    return bytes.length === byteIndex ? bytes : copyOf_1(bytes, byteIndex);
  }
  function codePointFromSurrogate(string, high, index, endIndex, throwOnMalformed) {
    _init_properties_utf8Encoding_kt__9thjs4();
    if (!(55296 <= high ? high <= 56319 : false) || index >= endIndex) {
      return malformed(0, index, throwOnMalformed);
    }
    // Inline function 'kotlin.code' call
    var this_0 = charCodeAt(string, index);
    var low = Char__toInt_impl_vasixd(this_0);
    if (!(56320 <= low ? low <= 57343 : false)) {
      return malformed(0, index, throwOnMalformed);
    }
    return 65536 + ((high & 1023) << 10) | 0 | low & 1023;
  }
  function malformed(size, index, throwOnMalformed) {
    _init_properties_utf8Encoding_kt__9thjs4();
    if (throwOnMalformed)
      throw new CharacterCodingException('Malformed sequence starting at ' + (index - 1 | 0));
    return -size | 0;
  }
  var properties_initialized_utf8Encoding_kt_eee1vq;
  function _init_properties_utf8Encoding_kt__9thjs4() {
    if (!properties_initialized_utf8Encoding_kt_eee1vq) {
      properties_initialized_utf8Encoding_kt_eee1vq = true;
      // Inline function 'kotlin.byteArrayOf' call
      REPLACEMENT_BYTE_SEQUENCE = new Int8Array([-17, -65, -67]);
    }
  }
  function AbstractCollection$toString$lambda(this$0) {
    return function (it) {
      return it === this$0 ? '(this Collection)' : toString_0(it);
    };
  }
  function AbstractCollection() {
  }
  protoOf(AbstractCollection).contains_aljjnj_k$ = function (element) {
    var tmp$ret$0;
    $l$block_0: {
      // Inline function 'kotlin.collections.any' call
      var tmp;
      if (isInterface(this, Collection)) {
        tmp = this.isEmpty_y1axqb_k$();
      } else {
        tmp = false;
      }
      if (tmp) {
        tmp$ret$0 = false;
        break $l$block_0;
      }
      var _iterator__ex2g4s = this.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element_0 = _iterator__ex2g4s.next_20eer_k$();
        if (equals(element_0, element)) {
          tmp$ret$0 = true;
          break $l$block_0;
        }
      }
      tmp$ret$0 = false;
    }
    return tmp$ret$0;
  };
  protoOf(AbstractCollection).containsAll_bwkf3g_k$ = function (elements) {
    var tmp$ret$0;
    $l$block_0: {
      // Inline function 'kotlin.collections.all' call
      var tmp;
      if (isInterface(elements, Collection)) {
        tmp = elements.isEmpty_y1axqb_k$();
      } else {
        tmp = false;
      }
      if (tmp) {
        tmp$ret$0 = true;
        break $l$block_0;
      }
      var _iterator__ex2g4s = elements.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        if (!this.contains_aljjnj_k$(element)) {
          tmp$ret$0 = false;
          break $l$block_0;
        }
      }
      tmp$ret$0 = true;
    }
    return tmp$ret$0;
  };
  protoOf(AbstractCollection).isEmpty_y1axqb_k$ = function () {
    return this.get_size_woubt6_k$() === 0;
  };
  protoOf(AbstractCollection).toString = function () {
    return joinToString_0(this, ', ', '[', ']', VOID, VOID, AbstractCollection$toString$lambda(this));
  };
  protoOf(AbstractCollection).toArray = function () {
    return collectionToArray(this);
  };
  function SubList_0(list, fromIndex, toIndex) {
    AbstractList.call(this);
    this.list_1 = list;
    this.fromIndex_1 = fromIndex;
    this._size_1 = 0;
    Companion_instance_4.checkRangeIndexes_mmy49x_k$(this.fromIndex_1, toIndex, this.list_1.get_size_woubt6_k$());
    this._size_1 = toIndex - this.fromIndex_1 | 0;
  }
  protoOf(SubList_0).get_c1px32_k$ = function (index) {
    Companion_instance_4.checkElementIndex_s0yg86_k$(index, this._size_1);
    return this.list_1.get_c1px32_k$(this.fromIndex_1 + index | 0);
  };
  protoOf(SubList_0).get_size_woubt6_k$ = function () {
    return this._size_1;
  };
  protoOf(SubList_0).subList_xle3r2_k$ = function (fromIndex, toIndex) {
    Companion_instance_4.checkRangeIndexes_mmy49x_k$(fromIndex, toIndex, this._size_1);
    return new SubList_0(this.list_1, this.fromIndex_1 + fromIndex | 0, this.fromIndex_1 + toIndex | 0);
  };
  function IteratorImpl_0($outer) {
    this.$this_1 = $outer;
    this.index_1 = 0;
  }
  protoOf(IteratorImpl_0).hasNext_bitz1p_k$ = function () {
    return this.index_1 < this.$this_1.get_size_woubt6_k$();
  };
  protoOf(IteratorImpl_0).next_20eer_k$ = function () {
    if (!this.hasNext_bitz1p_k$())
      throw NoSuchElementException_init_$Create$();
    var _unary__edvuaz = this.index_1;
    this.index_1 = _unary__edvuaz + 1 | 0;
    return this.$this_1.get_c1px32_k$(_unary__edvuaz);
  };
  function ListIteratorImpl_0($outer, index) {
    this.$this_2 = $outer;
    IteratorImpl_0.call(this, $outer);
    Companion_instance_4.checkPositionIndex_w4k0on_k$(index, this.$this_2.get_size_woubt6_k$());
    this.index_1 = index;
  }
  function Companion_4() {
    this.maxArraySize_1 = 2147483639;
  }
  protoOf(Companion_4).checkElementIndex_s0yg86_k$ = function (index, size) {
    if (index < 0 || index >= size) {
      throw IndexOutOfBoundsException_init_$Create$_0('index: ' + index + ', size: ' + size);
    }
  };
  protoOf(Companion_4).checkPositionIndex_w4k0on_k$ = function (index, size) {
    if (index < 0 || index > size) {
      throw IndexOutOfBoundsException_init_$Create$_0('index: ' + index + ', size: ' + size);
    }
  };
  protoOf(Companion_4).checkRangeIndexes_mmy49x_k$ = function (fromIndex, toIndex, size) {
    if (fromIndex < 0 || toIndex > size) {
      throw IndexOutOfBoundsException_init_$Create$_0('fromIndex: ' + fromIndex + ', toIndex: ' + toIndex + ', size: ' + size);
    }
    if (fromIndex > toIndex) {
      throw IllegalArgumentException_init_$Create$_0('fromIndex: ' + fromIndex + ' > toIndex: ' + toIndex);
    }
  };
  protoOf(Companion_4).newCapacity_k5ozfy_k$ = function (oldCapacity, minCapacity) {
    var newCapacity = oldCapacity + (oldCapacity >> 1) | 0;
    if ((newCapacity - minCapacity | 0) < 0)
      newCapacity = minCapacity;
    if ((newCapacity - 2147483639 | 0) > 0)
      newCapacity = minCapacity > 2147483639 ? 2147483647 : 2147483639;
    return newCapacity;
  };
  protoOf(Companion_4).orderedHashCode_srkix_k$ = function (c) {
    var hashCode = 1;
    var _iterator__ex2g4s = c.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var e = _iterator__ex2g4s.next_20eer_k$();
      var tmp = imul(31, hashCode);
      var tmp1_elvis_lhs = e == null ? null : hashCode_0(e);
      hashCode = tmp + (tmp1_elvis_lhs == null ? 0 : tmp1_elvis_lhs) | 0;
    }
    return hashCode;
  };
  protoOf(Companion_4).orderedEquals_jt170c_k$ = function (c, other) {
    if (!(c.get_size_woubt6_k$() === other.get_size_woubt6_k$()))
      return false;
    var otherIterator = other.iterator_jk1svi_k$();
    var _iterator__ex2g4s = c.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var elem = _iterator__ex2g4s.next_20eer_k$();
      var elemOther = otherIterator.next_20eer_k$();
      if (!equals(elem, elemOther)) {
        return false;
      }
    }
    return true;
  };
  var Companion_instance_4;
  function Companion_getInstance_4() {
    return Companion_instance_4;
  }
  function AbstractList() {
    AbstractCollection.call(this);
  }
  protoOf(AbstractList).iterator_jk1svi_k$ = function () {
    return new IteratorImpl_0(this);
  };
  protoOf(AbstractList).indexOf_si1fv9_k$ = function (element) {
    var tmp$ret$0;
    $l$block: {
      // Inline function 'kotlin.collections.indexOfFirst' call
      var index = 0;
      var _iterator__ex2g4s = this.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var item = _iterator__ex2g4s.next_20eer_k$();
        if (equals(item, element)) {
          tmp$ret$0 = index;
          break $l$block;
        }
        index = index + 1 | 0;
      }
      tmp$ret$0 = -1;
    }
    return tmp$ret$0;
  };
  protoOf(AbstractList).listIterator_70e65o_k$ = function (index) {
    return new ListIteratorImpl_0(this, index);
  };
  protoOf(AbstractList).subList_xle3r2_k$ = function (fromIndex, toIndex) {
    return new SubList_0(this, fromIndex, toIndex);
  };
  protoOf(AbstractList).equals = function (other) {
    if (other === this)
      return true;
    if (!(!(other == null) ? isInterface(other, KtList) : false))
      return false;
    return Companion_instance_4.orderedEquals_jt170c_k$(this, other);
  };
  protoOf(AbstractList).hashCode = function () {
    return Companion_instance_4.orderedHashCode_srkix_k$(this);
  };
  function AbstractMap$keys$1$iterator$1($entryIterator) {
    this.$entryIterator_1 = $entryIterator;
  }
  protoOf(AbstractMap$keys$1$iterator$1).hasNext_bitz1p_k$ = function () {
    return this.$entryIterator_1.hasNext_bitz1p_k$();
  };
  protoOf(AbstractMap$keys$1$iterator$1).next_20eer_k$ = function () {
    return this.$entryIterator_1.next_20eer_k$().get_key_18j28a_k$();
  };
  function AbstractMap$values$1$iterator$1($entryIterator) {
    this.$entryIterator_1 = $entryIterator;
  }
  protoOf(AbstractMap$values$1$iterator$1).hasNext_bitz1p_k$ = function () {
    return this.$entryIterator_1.hasNext_bitz1p_k$();
  };
  protoOf(AbstractMap$values$1$iterator$1).next_20eer_k$ = function () {
    return this.$entryIterator_1.next_20eer_k$().get_value_j01efc_k$();
  };
  function toString_2($this, entry) {
    return toString_3($this, entry.get_key_18j28a_k$()) + '=' + toString_3($this, entry.get_value_j01efc_k$());
  }
  function toString_3($this, o) {
    return o === $this ? '(this Map)' : toString_0(o);
  }
  function implFindEntry($this, key) {
    var tmp0 = $this.get_entries_p20ztl_k$();
    var tmp$ret$0;
    $l$block: {
      // Inline function 'kotlin.collections.firstOrNull' call
      var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        if (equals(element.get_key_18j28a_k$(), key)) {
          tmp$ret$0 = element;
          break $l$block;
        }
      }
      tmp$ret$0 = null;
    }
    return tmp$ret$0;
  }
  function Companion_5() {
  }
  var Companion_instance_5;
  function Companion_getInstance_5() {
    return Companion_instance_5;
  }
  function AbstractMap$keys$1(this$0) {
    this.this$0__1 = this$0;
    AbstractSet.call(this);
  }
  protoOf(AbstractMap$keys$1).contains_vbgn2f_k$ = function (element) {
    return this.this$0__1.containsKey_aw81wo_k$(element);
  };
  protoOf(AbstractMap$keys$1).contains_aljjnj_k$ = function (element) {
    if (!true)
      return false;
    return this.contains_vbgn2f_k$(element);
  };
  protoOf(AbstractMap$keys$1).iterator_jk1svi_k$ = function () {
    var entryIterator = this.this$0__1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    return new AbstractMap$keys$1$iterator$1(entryIterator);
  };
  protoOf(AbstractMap$keys$1).get_size_woubt6_k$ = function () {
    return this.this$0__1.get_size_woubt6_k$();
  };
  function AbstractMap$toString$lambda(this$0) {
    return function (it) {
      return toString_2(this$0, it);
    };
  }
  function AbstractMap$values$1(this$0) {
    this.this$0__1 = this$0;
    AbstractCollection.call(this);
  }
  protoOf(AbstractMap$values$1).contains_m22g8e_k$ = function (element) {
    return this.this$0__1.containsValue_yf2ykl_k$(element);
  };
  protoOf(AbstractMap$values$1).contains_aljjnj_k$ = function (element) {
    if (!true)
      return false;
    return this.contains_m22g8e_k$(element);
  };
  protoOf(AbstractMap$values$1).iterator_jk1svi_k$ = function () {
    var entryIterator = this.this$0__1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    return new AbstractMap$values$1$iterator$1(entryIterator);
  };
  protoOf(AbstractMap$values$1).get_size_woubt6_k$ = function () {
    return this.this$0__1.get_size_woubt6_k$();
  };
  function AbstractMap() {
    this._keys_1 = null;
    this._values_1 = null;
  }
  protoOf(AbstractMap).containsKey_aw81wo_k$ = function (key) {
    return !(implFindEntry(this, key) == null);
  };
  protoOf(AbstractMap).containsValue_yf2ykl_k$ = function (value) {
    var tmp0 = this.get_entries_p20ztl_k$();
    var tmp$ret$0;
    $l$block_0: {
      // Inline function 'kotlin.collections.any' call
      var tmp;
      if (isInterface(tmp0, Collection)) {
        tmp = tmp0.isEmpty_y1axqb_k$();
      } else {
        tmp = false;
      }
      if (tmp) {
        tmp$ret$0 = false;
        break $l$block_0;
      }
      var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        if (equals(element.get_value_j01efc_k$(), value)) {
          tmp$ret$0 = true;
          break $l$block_0;
        }
      }
      tmp$ret$0 = false;
    }
    return tmp$ret$0;
  };
  protoOf(AbstractMap).containsEntry_50dpfo_k$ = function (entry) {
    if (!(!(entry == null) ? isInterface(entry, Entry) : false))
      return false;
    var key = entry.get_key_18j28a_k$();
    var value = entry.get_value_j01efc_k$();
    // Inline function 'kotlin.collections.get' call
    var ourValue = (isInterface(this, KtMap) ? this : THROW_CCE()).get_wei43m_k$(key);
    if (!equals(value, ourValue)) {
      return false;
    }
    var tmp;
    if (ourValue == null) {
      // Inline function 'kotlin.collections.containsKey' call
      tmp = !(isInterface(this, KtMap) ? this : THROW_CCE()).containsKey_aw81wo_k$(key);
    } else {
      tmp = false;
    }
    if (tmp) {
      return false;
    }
    return true;
  };
  protoOf(AbstractMap).equals = function (other) {
    if (other === this)
      return true;
    if (!(!(other == null) ? isInterface(other, KtMap) : false))
      return false;
    if (!(this.get_size_woubt6_k$() === other.get_size_woubt6_k$()))
      return false;
    var tmp0 = other.get_entries_p20ztl_k$();
    var tmp$ret$0;
    $l$block_0: {
      // Inline function 'kotlin.collections.all' call
      var tmp;
      if (isInterface(tmp0, Collection)) {
        tmp = tmp0.isEmpty_y1axqb_k$();
      } else {
        tmp = false;
      }
      if (tmp) {
        tmp$ret$0 = true;
        break $l$block_0;
      }
      var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        if (!this.containsEntry_50dpfo_k$(element)) {
          tmp$ret$0 = false;
          break $l$block_0;
        }
      }
      tmp$ret$0 = true;
    }
    return tmp$ret$0;
  };
  protoOf(AbstractMap).get_wei43m_k$ = function (key) {
    var tmp0_safe_receiver = implFindEntry(this, key);
    return tmp0_safe_receiver == null ? null : tmp0_safe_receiver.get_value_j01efc_k$();
  };
  protoOf(AbstractMap).hashCode = function () {
    return hashCode_0(this.get_entries_p20ztl_k$());
  };
  protoOf(AbstractMap).isEmpty_y1axqb_k$ = function () {
    return this.get_size_woubt6_k$() === 0;
  };
  protoOf(AbstractMap).get_size_woubt6_k$ = function () {
    return this.get_entries_p20ztl_k$().get_size_woubt6_k$();
  };
  protoOf(AbstractMap).get_keys_wop4xp_k$ = function () {
    if (this._keys_1 == null) {
      var tmp = this;
      tmp._keys_1 = new AbstractMap$keys$1(this);
    }
    return ensureNotNull(this._keys_1);
  };
  protoOf(AbstractMap).toString = function () {
    var tmp = this.get_entries_p20ztl_k$();
    return joinToString_0(tmp, ', ', '{', '}', VOID, VOID, AbstractMap$toString$lambda(this));
  };
  protoOf(AbstractMap).get_values_ksazhn_k$ = function () {
    if (this._values_1 == null) {
      var tmp = this;
      tmp._values_1 = new AbstractMap$values$1(this);
    }
    return ensureNotNull(this._values_1);
  };
  function Companion_6() {
  }
  protoOf(Companion_6).unorderedHashCode_8c2ypq_k$ = function (c) {
    var hashCode = 0;
    var _iterator__ex2g4s = c.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      var tmp = hashCode;
      var tmp1_elvis_lhs = element == null ? null : hashCode_0(element);
      hashCode = tmp + (tmp1_elvis_lhs == null ? 0 : tmp1_elvis_lhs) | 0;
    }
    return hashCode;
  };
  protoOf(Companion_6).setEquals_mjzluv_k$ = function (c, other) {
    if (!(c.get_size_woubt6_k$() === other.get_size_woubt6_k$()))
      return false;
    return c.containsAll_bwkf3g_k$(other);
  };
  var Companion_instance_6;
  function Companion_getInstance_6() {
    return Companion_instance_6;
  }
  function AbstractSet() {
    AbstractCollection.call(this);
  }
  protoOf(AbstractSet).equals = function (other) {
    if (other === this)
      return true;
    if (!(!(other == null) ? isInterface(other, KtSet) : false))
      return false;
    return Companion_instance_6.setEquals_mjzluv_k$(this, other);
  };
  protoOf(AbstractSet).hashCode = function () {
    return Companion_instance_6.unorderedHashCode_8c2ypq_k$(this);
  };
  function get_lastIndex_0(_this__u8e3s4) {
    return _this__u8e3s4.get_size_woubt6_k$() - 1 | 0;
  }
  function throwIndexOverflow() {
    throw ArithmeticException_init_$Create$_0('Index overflow has happened.');
  }
  function collectionToArrayCommonImpl(collection) {
    if (collection.isEmpty_y1axqb_k$()) {
      // Inline function 'kotlin.emptyArray' call
      return [];
    }
    // Inline function 'kotlin.arrayOfNulls' call
    var size = collection.get_size_woubt6_k$();
    var destination = Array(size);
    var iterator = collection.iterator_jk1svi_k$();
    var index = 0;
    while (iterator.hasNext_bitz1p_k$()) {
      var _unary__edvuaz = index;
      index = _unary__edvuaz + 1 | 0;
      destination[_unary__edvuaz] = iterator.next_20eer_k$();
    }
    return destination;
  }
  function listOf_0(elements) {
    return elements.length > 0 ? asList(elements) : emptyList();
  }
  function emptyList() {
    return EmptyList_getInstance();
  }
  function listOfNotNull(elements) {
    return filterNotNull(elements);
  }
  function get_indices(_this__u8e3s4) {
    return numberRangeToNumber(0, _this__u8e3s4.get_size_woubt6_k$() - 1 | 0);
  }
  function EmptyList() {
    EmptyList_instance = this;
    this.serialVersionUID_1 = new Long(-1478467534, -1720727600);
  }
  protoOf(EmptyList).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, KtList) : false) {
      tmp = other.isEmpty_y1axqb_k$();
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(EmptyList).hashCode = function () {
    return 1;
  };
  protoOf(EmptyList).toString = function () {
    return '[]';
  };
  protoOf(EmptyList).get_size_woubt6_k$ = function () {
    return 0;
  };
  protoOf(EmptyList).isEmpty_y1axqb_k$ = function () {
    return true;
  };
  protoOf(EmptyList).contains_a7ux40_k$ = function (element) {
    return false;
  };
  protoOf(EmptyList).contains_aljjnj_k$ = function (element) {
    if (!false)
      return false;
    var tmp;
    if (false) {
      tmp = element;
    } else {
      tmp = THROW_CCE();
    }
    return this.contains_a7ux40_k$(tmp);
  };
  protoOf(EmptyList).get_c1px32_k$ = function (index) {
    throw IndexOutOfBoundsException_init_$Create$_0("Empty list doesn't contain element at index " + index + '.');
  };
  protoOf(EmptyList).indexOf_31ms1i_k$ = function (element) {
    return -1;
  };
  protoOf(EmptyList).indexOf_si1fv9_k$ = function (element) {
    if (!false)
      return -1;
    var tmp;
    if (false) {
      tmp = element;
    } else {
      tmp = THROW_CCE();
    }
    return this.indexOf_31ms1i_k$(tmp);
  };
  protoOf(EmptyList).iterator_jk1svi_k$ = function () {
    return EmptyIterator_instance;
  };
  protoOf(EmptyList).listIterator_70e65o_k$ = function (index) {
    if (!(index === 0))
      throw IndexOutOfBoundsException_init_$Create$_0('Index: ' + index);
    return EmptyIterator_instance;
  };
  protoOf(EmptyList).subList_xle3r2_k$ = function (fromIndex, toIndex) {
    if (fromIndex === 0 && toIndex === 0)
      return this;
    throw IndexOutOfBoundsException_init_$Create$_0('fromIndex: ' + fromIndex + ', toIndex: ' + toIndex);
  };
  var EmptyList_instance;
  function EmptyList_getInstance() {
    if (EmptyList_instance == null)
      new EmptyList();
    return EmptyList_instance;
  }
  function EmptyIterator() {
  }
  protoOf(EmptyIterator).hasNext_bitz1p_k$ = function () {
    return false;
  };
  protoOf(EmptyIterator).next_20eer_k$ = function () {
    throw NoSuchElementException_init_$Create$();
  };
  var EmptyIterator_instance;
  function EmptyIterator_getInstance() {
    return EmptyIterator_instance;
  }
  function optimizeReadOnlyList(_this__u8e3s4) {
    switch (_this__u8e3s4.get_size_woubt6_k$()) {
      case 0:
        return emptyList();
      case 1:
        return listOf(_this__u8e3s4.get_c1px32_k$(0));
      default:
        return _this__u8e3s4;
    }
  }
  function throwCountOverflow() {
    throw ArithmeticException_init_$Create$_0('Count overflow has happened.');
  }
  function IndexedValue(index, value) {
    this.index_1 = index;
    this.value_1 = value;
  }
  protoOf(IndexedValue).component1_7eebsc_k$ = function () {
    return this.index_1;
  };
  protoOf(IndexedValue).component2_7eebsb_k$ = function () {
    return this.value_1;
  };
  protoOf(IndexedValue).toString = function () {
    return 'IndexedValue(index=' + this.index_1 + ', value=' + toString_0(this.value_1) + ')';
  };
  protoOf(IndexedValue).hashCode = function () {
    var result = this.index_1;
    result = imul(result, 31) + (this.value_1 == null ? 0 : hashCode_0(this.value_1)) | 0;
    return result;
  };
  protoOf(IndexedValue).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof IndexedValue))
      return false;
    if (!(this.index_1 === other.index_1))
      return false;
    if (!equals(this.value_1, other.value_1))
      return false;
    return true;
  };
  function IndexingIterable(iteratorFactory) {
    this.iteratorFactory_1 = iteratorFactory;
  }
  protoOf(IndexingIterable).iterator_jk1svi_k$ = function () {
    return new IndexingIterator(this.iteratorFactory_1());
  };
  function collectionSizeOrDefault(_this__u8e3s4, default_0) {
    var tmp;
    if (isInterface(_this__u8e3s4, Collection)) {
      tmp = _this__u8e3s4.get_size_woubt6_k$();
    } else {
      tmp = default_0;
    }
    return tmp;
  }
  function collectionSizeOrNull(_this__u8e3s4) {
    var tmp;
    if (isInterface(_this__u8e3s4, Collection)) {
      tmp = _this__u8e3s4.get_size_woubt6_k$();
    } else {
      tmp = null;
    }
    return tmp;
  }
  function IndexingIterator(iterator) {
    this.iterator_1 = iterator;
    this.index_1 = 0;
  }
  protoOf(IndexingIterator).hasNext_bitz1p_k$ = function () {
    return this.iterator_1.hasNext_bitz1p_k$();
  };
  protoOf(IndexingIterator).next_20eer_k$ = function () {
    var _unary__edvuaz = this.index_1;
    this.index_1 = _unary__edvuaz + 1 | 0;
    return new IndexedValue(checkIndexOverflow(_unary__edvuaz), this.iterator_1.next_20eer_k$());
  };
  function getOrImplicitDefault(_this__u8e3s4, key) {
    if (isInterface(_this__u8e3s4, MapWithDefault))
      return _this__u8e3s4.getOrImplicitDefault_figf1n_k$(key);
    var tmp$ret$0;
    $l$block_0: {
      // Inline function 'kotlin.collections.getOrElseIfMissing' call
      var value = _this__u8e3s4.get_wei43m_k$(key);
      if (value == null && !_this__u8e3s4.containsKey_aw81wo_k$(key)) {
        throw NoSuchElementException_init_$Create$_0('Key ' + toString_0(key) + ' is missing in the map.');
      } else {
        tmp$ret$0 = value;
        break $l$block_0;
      }
    }
    return tmp$ret$0;
  }
  function MapWithDefault() {
  }
  function mutableMapOf(pairs) {
    // Inline function 'kotlin.apply' call
    var this_0 = LinkedHashMap_init_$Create$_0(mapCapacity(pairs.length));
    putAll(this_0, pairs);
    return this_0;
  }
  function getValue(_this__u8e3s4, key) {
    return getOrImplicitDefault(_this__u8e3s4, key);
  }
  function mapOf_0(pairs) {
    return pairs.length > 0 ? toMap(pairs, LinkedHashMap_init_$Create$_0(mapCapacity(pairs.length))) : emptyMap();
  }
  function linkedMapOf(pairs) {
    return toMap(pairs, LinkedHashMap_init_$Create$_0(mapCapacity(pairs.length)));
  }
  function emptyMap() {
    var tmp = EmptyMap_getInstance();
    return isInterface(tmp, KtMap) ? tmp : THROW_CCE();
  }
  function plus_1(_this__u8e3s4, map) {
    // Inline function 'kotlin.apply' call
    var this_0 = LinkedHashMap_init_$Create$_1(_this__u8e3s4);
    this_0.putAll_wgg6cj_k$(map);
    return this_0;
  }
  function plus_2(_this__u8e3s4, pair) {
    var tmp;
    if (_this__u8e3s4.isEmpty_y1axqb_k$()) {
      tmp = mapOf(pair);
    } else {
      // Inline function 'kotlin.apply' call
      var this_0 = LinkedHashMap_init_$Create$_1(_this__u8e3s4);
      this_0.put_4fpzoq_k$(pair.first_1, pair.second_1);
      tmp = this_0;
    }
    return tmp;
  }
  function toMutableMap(_this__u8e3s4) {
    return LinkedHashMap_init_$Create$_1(_this__u8e3s4);
  }
  function putAll(_this__u8e3s4, pairs) {
    var inductionVariable = 0;
    var last = pairs.length;
    while (inductionVariable < last) {
      var _destruct__k2r9zo = pairs[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var key = _destruct__k2r9zo.component1_7eebsc_k$();
      var value = _destruct__k2r9zo.component2_7eebsb_k$();
      _this__u8e3s4.put_4fpzoq_k$(key, value);
    }
  }
  function toMap(_this__u8e3s4, destination) {
    // Inline function 'kotlin.apply' call
    putAll(destination, _this__u8e3s4);
    return destination;
  }
  function EmptyMap() {
    EmptyMap_instance = this;
    this.serialVersionUID_1 = new Long(-888910638, 1920087921);
  }
  protoOf(EmptyMap).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, KtMap) : false) {
      tmp = other.isEmpty_y1axqb_k$();
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(EmptyMap).hashCode = function () {
    return 0;
  };
  protoOf(EmptyMap).toString = function () {
    return '{}';
  };
  protoOf(EmptyMap).get_size_woubt6_k$ = function () {
    return 0;
  };
  protoOf(EmptyMap).isEmpty_y1axqb_k$ = function () {
    return true;
  };
  protoOf(EmptyMap).containsKey_v2r3nj_k$ = function (key) {
    return false;
  };
  protoOf(EmptyMap).containsKey_aw81wo_k$ = function (key) {
    if (!true)
      return false;
    return this.containsKey_v2r3nj_k$(key);
  };
  protoOf(EmptyMap).get_eccq09_k$ = function (key) {
    return null;
  };
  protoOf(EmptyMap).get_wei43m_k$ = function (key) {
    if (!true)
      return null;
    return this.get_eccq09_k$(key);
  };
  protoOf(EmptyMap).get_entries_p20ztl_k$ = function () {
    return EmptySet_getInstance();
  };
  protoOf(EmptyMap).get_keys_wop4xp_k$ = function () {
    return EmptySet_getInstance();
  };
  protoOf(EmptyMap).get_values_ksazhn_k$ = function () {
    return EmptyList_getInstance();
  };
  var EmptyMap_instance;
  function EmptyMap_getInstance() {
    if (EmptyMap_instance == null)
      new EmptyMap();
    return EmptyMap_instance;
  }
  function hashMapOf(pairs) {
    // Inline function 'kotlin.apply' call
    var this_0 = HashMap_init_$Create$_0(mapCapacity(pairs.length));
    putAll(this_0, pairs);
    return this_0;
  }
  function addAll(_this__u8e3s4, elements) {
    if (isInterface(elements, Collection))
      return _this__u8e3s4.addAll_h3ej1q_k$(elements);
    else {
      var result = false;
      var _iterator__ex2g4s = elements.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var item = _iterator__ex2g4s.next_20eer_k$();
        if (_this__u8e3s4.add_utx5q5_k$(item))
          result = true;
      }
      return result;
    }
  }
  function CharIterator() {
  }
  protoOf(CharIterator).next_30xa17_k$ = function () {
    return this.nextChar_yvnk6j_k$();
  };
  protoOf(CharIterator).next_20eer_k$ = function () {
    return new Char(this.next_30xa17_k$());
  };
  function IntIterator() {
  }
  protoOf(IntIterator).next_20eer_k$ = function () {
    return this.nextInt_ujorgc_k$();
  };
  function emptySet() {
    return EmptySet_getInstance();
  }
  function EmptySet() {
    EmptySet_instance = this;
    this.serialVersionUID_1 = new Long(1993859828, 793161749);
  }
  protoOf(EmptySet).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, KtSet) : false) {
      tmp = other.isEmpty_y1axqb_k$();
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(EmptySet).hashCode = function () {
    return 0;
  };
  protoOf(EmptySet).toString = function () {
    return '[]';
  };
  protoOf(EmptySet).get_size_woubt6_k$ = function () {
    return 0;
  };
  protoOf(EmptySet).isEmpty_y1axqb_k$ = function () {
    return true;
  };
  protoOf(EmptySet).contains_a7ux40_k$ = function (element) {
    return false;
  };
  protoOf(EmptySet).contains_aljjnj_k$ = function (element) {
    if (!false)
      return false;
    var tmp;
    if (false) {
      tmp = element;
    } else {
      tmp = THROW_CCE();
    }
    return this.contains_a7ux40_k$(tmp);
  };
  protoOf(EmptySet).containsAll_4yme17_k$ = function (elements) {
    return elements.isEmpty_y1axqb_k$();
  };
  protoOf(EmptySet).containsAll_bwkf3g_k$ = function (elements) {
    return this.containsAll_4yme17_k$(elements);
  };
  protoOf(EmptySet).iterator_jk1svi_k$ = function () {
    return EmptyIterator_instance;
  };
  var EmptySet_instance;
  function EmptySet_getInstance() {
    if (EmptySet_instance == null)
      new EmptySet();
    return EmptySet_instance;
  }
  function optimizeReadOnlySet(_this__u8e3s4) {
    switch (_this__u8e3s4.get_size_woubt6_k$()) {
      case 0:
        return emptySet();
      case 1:
        return setOf(_this__u8e3s4.iterator_jk1svi_k$().next_20eer_k$());
      default:
        return _this__u8e3s4;
    }
  }
  function hashSetOf(elements) {
    return toCollection(elements, HashSet_init_$Create$_0(mapCapacity(elements.length)));
  }
  function compareValues(a, b) {
    if (a == null)
      return b == null ? 0 : -1;
    if (b == null)
      return 1;
    return compareTo((!(a == null) ? isComparable(a) : false) ? a : THROW_CCE(), b);
  }
  function EnumEntriesList(entries) {
    AbstractList.call(this);
    this.entries_1 = entries;
  }
  protoOf(EnumEntriesList).get_size_woubt6_k$ = function () {
    return this.entries_1.length;
  };
  protoOf(EnumEntriesList).get_c1px32_k$ = function (index) {
    Companion_instance_4.checkElementIndex_s0yg86_k$(index, this.entries_1.length);
    return this.entries_1[index];
  };
  protoOf(EnumEntriesList).contains_qvgeh3_k$ = function (element) {
    if (element === null)
      return false;
    var target = getOrNull(this.entries_1, element.ordinal_1);
    return target === element;
  };
  protoOf(EnumEntriesList).contains_aljjnj_k$ = function (element) {
    if (!(element instanceof Enum))
      return false;
    return this.contains_qvgeh3_k$(element instanceof Enum ? element : THROW_CCE());
  };
  protoOf(EnumEntriesList).indexOf_cbd19f_k$ = function (element) {
    if (element === null)
      return -1;
    var ordinal = element.ordinal_1;
    var target = getOrNull(this.entries_1, ordinal);
    return target === element ? ordinal : -1;
  };
  protoOf(EnumEntriesList).indexOf_si1fv9_k$ = function (element) {
    if (!(element instanceof Enum))
      return -1;
    return this.indexOf_cbd19f_k$(element instanceof Enum ? element : THROW_CCE());
  };
  function enumEntries(entries) {
    return new EnumEntriesList(entries);
  }
  function getProgressionLastElement(start, end, step) {
    var tmp;
    if (step > 0) {
      tmp = start >= end ? end : end - differenceModulo(end, start, step) | 0;
    } else if (step < 0) {
      tmp = start <= end ? end : end + differenceModulo(start, end, -step | 0) | 0;
    } else {
      throw IllegalArgumentException_init_$Create$_0('Step is zero.');
    }
    return tmp;
  }
  function differenceModulo(a, b, c) {
    return mod(mod(a, c) - mod(b, c) | 0, c);
  }
  function mod(a, b) {
    var mod = a % b | 0;
    return mod >= 0 ? mod : mod + b | 0;
  }
  function Companion_7() {
    Companion_instance_7 = this;
    this.EMPTY_1 = new CharRange(_Char___init__impl__6a9atx(1), _Char___init__impl__6a9atx(0));
  }
  var Companion_instance_7;
  function Companion_getInstance_7() {
    if (Companion_instance_7 == null) {
      Companion_instance_9;
      new Companion_7();
    }
    return Companion_instance_7;
  }
  function CharRange(start, endInclusive) {
    Companion_getInstance_7();
    CharProgression.call(this, start, endInclusive, 1);
  }
  protoOf(CharRange).contains_egozq6_k$ = function (value) {
    return Char__compareTo_impl_ypi4mb(this.first_1, value) <= 0 && Char__compareTo_impl_ypi4mb(value, this.last_1) <= 0;
  };
  protoOf(CharRange).isEmpty_y1axqb_k$ = function () {
    return Char__compareTo_impl_ypi4mb(this.first_1, this.last_1) > 0;
  };
  protoOf(CharRange).equals = function (other) {
    var tmp;
    if (other instanceof CharRange) {
      tmp = this.isEmpty_y1axqb_k$() && other.isEmpty_y1axqb_k$() || (this.first_1 === other.first_1 && this.last_1 === other.last_1);
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(CharRange).hashCode = function () {
    var tmp;
    if (this.isEmpty_y1axqb_k$()) {
      tmp = -1;
    } else {
      // Inline function 'kotlin.code' call
      var this_0 = this.first_1;
      var tmp$ret$0 = Char__toInt_impl_vasixd(this_0);
      var tmp_0 = imul(31, tmp$ret$0);
      // Inline function 'kotlin.code' call
      var this_1 = this.last_1;
      tmp = tmp_0 + Char__toInt_impl_vasixd(this_1) | 0;
    }
    return tmp;
  };
  protoOf(CharRange).toString = function () {
    return toString(this.first_1) + '..' + toString(this.last_1);
  };
  function Companion_8() {
    Companion_instance_8 = this;
    this.EMPTY_1 = new IntRange(1, 0);
  }
  var Companion_instance_8;
  function Companion_getInstance_8() {
    if (Companion_instance_8 == null) {
      Companion_instance_10;
      new Companion_8();
    }
    return Companion_instance_8;
  }
  function IntRange(start, endInclusive) {
    Companion_getInstance_8();
    IntProgression.call(this, start, endInclusive, 1);
  }
  protoOf(IntRange).get_start_iypx6h_k$ = function () {
    return this.first_1;
  };
  protoOf(IntRange).get_endInclusive_r07xpi_k$ = function () {
    return this.last_1;
  };
  protoOf(IntRange).isEmpty_y1axqb_k$ = function () {
    return this.first_1 > this.last_1;
  };
  protoOf(IntRange).equals = function (other) {
    var tmp;
    if (other instanceof IntRange) {
      tmp = this.isEmpty_y1axqb_k$() && other.isEmpty_y1axqb_k$() || (this.first_1 === other.first_1 && this.last_1 === other.last_1);
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(IntRange).hashCode = function () {
    return this.isEmpty_y1axqb_k$() ? -1 : imul(31, this.first_1) + this.last_1 | 0;
  };
  protoOf(IntRange).toString = function () {
    return '' + this.first_1 + '..' + this.last_1;
  };
  function CharProgressionIterator(first, last, step) {
    CharIterator.call(this);
    this.step_1 = step;
    var tmp = this;
    // Inline function 'kotlin.code' call
    tmp.finalElement_1 = Char__toInt_impl_vasixd(last);
    this.hasNext_1 = this.step_1 > 0 ? Char__compareTo_impl_ypi4mb(first, last) <= 0 : Char__compareTo_impl_ypi4mb(first, last) >= 0;
    var tmp_0 = this;
    var tmp_1;
    if (this.hasNext_1) {
      // Inline function 'kotlin.code' call
      tmp_1 = Char__toInt_impl_vasixd(first);
    } else {
      tmp_1 = this.finalElement_1;
    }
    tmp_0.next_1 = tmp_1;
  }
  protoOf(CharProgressionIterator).hasNext_bitz1p_k$ = function () {
    return this.hasNext_1;
  };
  protoOf(CharProgressionIterator).nextChar_yvnk6j_k$ = function () {
    var value = this.next_1;
    if (value === this.finalElement_1) {
      if (!this.hasNext_1)
        throw NoSuchElementException_init_$Create$();
      this.hasNext_1 = false;
    } else {
      this.next_1 = this.next_1 + this.step_1 | 0;
    }
    return numberToChar(value);
  };
  function IntProgressionIterator(first, last, step) {
    IntIterator.call(this);
    this.step_1 = step;
    this.finalElement_1 = last;
    this.hasNext_1 = this.step_1 > 0 ? first <= last : first >= last;
    this.next_1 = this.hasNext_1 ? first : this.finalElement_1;
  }
  protoOf(IntProgressionIterator).hasNext_bitz1p_k$ = function () {
    return this.hasNext_1;
  };
  protoOf(IntProgressionIterator).nextInt_ujorgc_k$ = function () {
    var value = this.next_1;
    if (value === this.finalElement_1) {
      if (!this.hasNext_1)
        throw NoSuchElementException_init_$Create$();
      this.hasNext_1 = false;
    } else {
      this.next_1 = this.next_1 + this.step_1 | 0;
    }
    return value;
  };
  function Companion_9() {
  }
  var Companion_instance_9;
  function Companion_getInstance_9() {
    return Companion_instance_9;
  }
  function CharProgression(start, endInclusive, step) {
    if (step === 0)
      throw IllegalArgumentException_init_$Create$_0('Step must be non-zero.');
    if (step === -2147483648)
      throw IllegalArgumentException_init_$Create$_0('Step must be greater than Int.MIN_VALUE to avoid overflow on negation.');
    this.first_1 = start;
    var tmp = this;
    // Inline function 'kotlin.code' call
    var tmp_0 = Char__toInt_impl_vasixd(start);
    // Inline function 'kotlin.code' call
    var tmp$ret$1 = Char__toInt_impl_vasixd(endInclusive);
    tmp.last_1 = numberToChar(getProgressionLastElement(tmp_0, tmp$ret$1, step));
    this.step_1 = step;
  }
  protoOf(CharProgression).iterator_jk1svi_k$ = function () {
    return new CharProgressionIterator(this.first_1, this.last_1, this.step_1);
  };
  protoOf(CharProgression).isEmpty_y1axqb_k$ = function () {
    return this.step_1 > 0 ? Char__compareTo_impl_ypi4mb(this.first_1, this.last_1) > 0 : Char__compareTo_impl_ypi4mb(this.first_1, this.last_1) < 0;
  };
  protoOf(CharProgression).equals = function (other) {
    var tmp;
    if (other instanceof CharProgression) {
      tmp = this.isEmpty_y1axqb_k$() && other.isEmpty_y1axqb_k$() || (this.first_1 === other.first_1 && this.last_1 === other.last_1 && this.step_1 === other.step_1);
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(CharProgression).hashCode = function () {
    var tmp;
    if (this.isEmpty_y1axqb_k$()) {
      tmp = -1;
    } else {
      // Inline function 'kotlin.code' call
      var this_0 = this.first_1;
      var tmp$ret$0 = Char__toInt_impl_vasixd(this_0);
      var tmp_0 = imul(31, tmp$ret$0);
      // Inline function 'kotlin.code' call
      var this_1 = this.last_1;
      var tmp$ret$1 = Char__toInt_impl_vasixd(this_1);
      tmp = imul(31, tmp_0 + tmp$ret$1 | 0) + this.step_1 | 0;
    }
    return tmp;
  };
  protoOf(CharProgression).toString = function () {
    return this.step_1 > 0 ? toString(this.first_1) + '..' + toString(this.last_1) + ' step ' + this.step_1 : toString(this.first_1) + ' downTo ' + toString(this.last_1) + ' step ' + (-this.step_1 | 0);
  };
  function Companion_10() {
  }
  protoOf(Companion_10).fromClosedRange_y6bqsv_k$ = function (rangeStart, rangeEnd, step) {
    return new IntProgression(rangeStart, rangeEnd, step);
  };
  var Companion_instance_10;
  function Companion_getInstance_10() {
    return Companion_instance_10;
  }
  function IntProgression(start, endInclusive, step) {
    if (step === 0)
      throw IllegalArgumentException_init_$Create$_0('Step must be non-zero.');
    if (step === -2147483648)
      throw IllegalArgumentException_init_$Create$_0('Step must be greater than Int.MIN_VALUE to avoid overflow on negation.');
    this.first_1 = start;
    this.last_1 = getProgressionLastElement(start, endInclusive, step);
    this.step_1 = step;
  }
  protoOf(IntProgression).iterator_jk1svi_k$ = function () {
    return new IntProgressionIterator(this.first_1, this.last_1, this.step_1);
  };
  protoOf(IntProgression).isEmpty_y1axqb_k$ = function () {
    return this.step_1 > 0 ? this.first_1 > this.last_1 : this.first_1 < this.last_1;
  };
  protoOf(IntProgression).equals = function (other) {
    var tmp;
    if (other instanceof IntProgression) {
      tmp = this.isEmpty_y1axqb_k$() && other.isEmpty_y1axqb_k$() || (this.first_1 === other.first_1 && this.last_1 === other.last_1 && this.step_1 === other.step_1);
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(IntProgression).hashCode = function () {
    return this.isEmpty_y1axqb_k$() ? -1 : imul(31, imul(31, this.first_1) + this.last_1 | 0) + this.step_1 | 0;
  };
  protoOf(IntProgression).toString = function () {
    return this.step_1 > 0 ? '' + this.first_1 + '..' + this.last_1 + ' step ' + this.step_1 : '' + this.first_1 + ' downTo ' + this.last_1 + ' step ' + (-this.step_1 | 0);
  };
  function appendElement(_this__u8e3s4, element, transform) {
    if (!(transform == null))
      _this__u8e3s4.append_jgojdo_k$(transform(element));
    else {
      if (element == null ? true : isCharSequence(element))
        _this__u8e3s4.append_jgojdo_k$(element);
      else {
        if (element instanceof Char)
          _this__u8e3s4.append_58al37_k$(element.value_1);
        else {
          _this__u8e3s4.append_jgojdo_k$(toString_1(element));
        }
      }
    }
  }
  function equals_1(_this__u8e3s4, other, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    if (_this__u8e3s4 === other)
      return true;
    if (!ignoreCase)
      return false;
    var thisUpper = uppercaseChar(_this__u8e3s4);
    var otherUpper = uppercaseChar(other);
    var tmp;
    if (thisUpper === otherUpper) {
      tmp = true;
    } else {
      // Inline function 'kotlin.text.lowercaseChar' call
      // Inline function 'kotlin.text.lowercase' call
      // Inline function 'kotlin.js.asDynamic' call
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp$ret$1 = toString(thisUpper).toLowerCase();
      var tmp_0 = charCodeAt(tmp$ret$1, 0);
      // Inline function 'kotlin.text.lowercaseChar' call
      // Inline function 'kotlin.text.lowercase' call
      // Inline function 'kotlin.js.asDynamic' call
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp$ret$5 = toString(otherUpper).toLowerCase();
      tmp = tmp_0 === charCodeAt(tmp$ret$5, 0);
    }
    return tmp;
  }
  function toLongOrNull(_this__u8e3s4) {
    return toLongOrNull_0(_this__u8e3s4, 10);
  }
  function toIntOrNull(_this__u8e3s4) {
    return toIntOrNull_0(_this__u8e3s4, 10);
  }
  function numberFormatError(input) {
    throw NumberFormatException_init_$Create$_0("Invalid number format: '" + input + "'");
  }
  function toLongOrNull_0(_this__u8e3s4, radix) {
    checkRadix(radix);
    var length = _this__u8e3s4.length;
    if (length === 0)
      return null;
    var start;
    var isNegative;
    var limit;
    var firstChar = charCodeAt(_this__u8e3s4, 0);
    if (Char__compareTo_impl_ypi4mb(firstChar, _Char___init__impl__6a9atx(48)) < 0) {
      if (length === 1)
        return null;
      start = 1;
      if (firstChar === _Char___init__impl__6a9atx(45)) {
        isNegative = true;
        limit = new Long(0, -2147483648);
      } else if (firstChar === _Char___init__impl__6a9atx(43)) {
        isNegative = false;
        limit = new Long(1, -2147483648);
      } else
        return null;
    } else {
      start = 0;
      isNegative = false;
      limit = new Long(1, -2147483648);
    }
    // Inline function 'kotlin.Long.div' call
    var this_0 = new Long(1, -2147483648);
    var limitForMaxRadix = divide(this_0, fromInt(36));
    var limitBeforeMul = limitForMaxRadix;
    var result = new Long(0, 0);
    var inductionVariable = start;
    if (inductionVariable < length)
      do {
        var i = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        var digit = digitOf(charCodeAt(_this__u8e3s4, i), radix);
        if (digit < 0)
          return null;
        if (compare(result, limitBeforeMul) < 0) {
          if (equalsLong(limitBeforeMul, limitForMaxRadix)) {
            // Inline function 'kotlin.Long.div' call
            var this_1 = limit;
            limitBeforeMul = divide(this_1, fromInt(radix));
            if (compare(result, limitBeforeMul) < 0) {
              return null;
            }
          } else {
            return null;
          }
        }
        // Inline function 'kotlin.Long.times' call
        var this_2 = result;
        result = multiply(this_2, fromInt(radix));
        var tmp = result;
        // Inline function 'kotlin.Long.plus' call
        var this_3 = limit;
        var tmp$ret$3 = add(this_3, fromInt(digit));
        if (compare(tmp, tmp$ret$3) < 0)
          return null;
        // Inline function 'kotlin.Long.minus' call
        var this_4 = result;
        result = subtract(this_4, fromInt(digit));
      }
       while (inductionVariable < length);
    return isNegative ? result : negate(result);
  }
  function toIntOrNull_0(_this__u8e3s4, radix) {
    checkRadix(radix);
    var length = _this__u8e3s4.length;
    if (length === 0)
      return null;
    var start;
    var isNegative;
    var limit;
    var firstChar = charCodeAt(_this__u8e3s4, 0);
    if (Char__compareTo_impl_ypi4mb(firstChar, _Char___init__impl__6a9atx(48)) < 0) {
      if (length === 1)
        return null;
      start = 1;
      if (firstChar === _Char___init__impl__6a9atx(45)) {
        isNegative = true;
        limit = -2147483648;
      } else if (firstChar === _Char___init__impl__6a9atx(43)) {
        isNegative = false;
        limit = -2147483647;
      } else
        return null;
    } else {
      start = 0;
      isNegative = false;
      limit = -2147483647;
    }
    var limitForMaxRadix = -59652323;
    var limitBeforeMul = limitForMaxRadix;
    var result = 0;
    var inductionVariable = start;
    if (inductionVariable < length)
      do {
        var i = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        var digit = digitOf(charCodeAt(_this__u8e3s4, i), radix);
        if (digit < 0)
          return null;
        if (result < limitBeforeMul) {
          if (limitBeforeMul === limitForMaxRadix) {
            limitBeforeMul = limit / radix | 0;
            if (result < limitBeforeMul) {
              return null;
            }
          } else {
            return null;
          }
        }
        result = imul(result, radix);
        if (result < (limit + digit | 0))
          return null;
        result = result - digit | 0;
      }
       while (inductionVariable < length);
    return isNegative ? result : -result | 0;
  }
  function iterator(_this__u8e3s4) {
    return new iterator$1(_this__u8e3s4);
  }
  function padStart(_this__u8e3s4, length, padChar) {
    padChar = padChar === VOID ? _Char___init__impl__6a9atx(32) : padChar;
    return toString_1(padStart_0(isCharSequence(_this__u8e3s4) ? _this__u8e3s4 : THROW_CCE(), length, padChar));
  }
  function trimEnd(_this__u8e3s4, chars) {
    // Inline function 'kotlin.text.trimEnd' call
    var tmp0 = isCharSequence(_this__u8e3s4) ? _this__u8e3s4 : THROW_CCE();
    var tmp$ret$1;
    $l$block: {
      // Inline function 'kotlin.text.trimEnd' call
      var inductionVariable = charSequenceLength(tmp0) - 1 | 0;
      if (0 <= inductionVariable)
        do {
          var index = inductionVariable;
          inductionVariable = inductionVariable + -1 | 0;
          var it = charSequenceGet(tmp0, index);
          if (!contains(chars, it)) {
            tmp$ret$1 = charSequenceSubSequence(tmp0, 0, index + 1 | 0);
            break $l$block;
          }
        }
         while (0 <= inductionVariable);
      tmp$ret$1 = '';
    }
    return toString_1(tmp$ret$1);
  }
  function isBlank(_this__u8e3s4) {
    var tmp$ret$0;
    $l$block: {
      // Inline function 'kotlin.text.all' call
      var inductionVariable = 0;
      while (inductionVariable < charSequenceLength(_this__u8e3s4)) {
        var element = charSequenceGet(_this__u8e3s4, inductionVariable);
        inductionVariable = inductionVariable + 1 | 0;
        if (!isWhitespace(element)) {
          tmp$ret$0 = false;
          break $l$block;
        }
      }
      tmp$ret$0 = true;
    }
    return tmp$ret$0;
  }
  function contains_1(_this__u8e3s4, other, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    var tmp;
    if (typeof other === 'string') {
      tmp = indexOf_3(_this__u8e3s4, other, VOID, ignoreCase) >= 0;
    } else {
      tmp = indexOf_4(_this__u8e3s4, other, 0, charSequenceLength(_this__u8e3s4), ignoreCase) >= 0;
    }
    return tmp;
  }
  function split(_this__u8e3s4, delimiters, ignoreCase, limit) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    limit = limit === VOID ? 0 : limit;
    if (delimiters.length === 1) {
      var delimiter = delimiters[0];
      // Inline function 'kotlin.text.isNotEmpty' call
      if (charSequenceLength(delimiter) > 0) {
        return split_1(_this__u8e3s4, delimiter, ignoreCase, limit);
      }
    }
    // Inline function 'kotlin.collections.map' call
    var this_0 = asIterable(rangesDelimitedBy(_this__u8e3s4, delimiters, VOID, ignoreCase, limit));
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$3 = substring_1(_this__u8e3s4, item);
      destination.add_utx5q5_k$(tmp$ret$3);
    }
    return destination;
  }
  function indexOf_2(_this__u8e3s4, char, startIndex, ignoreCase) {
    startIndex = startIndex === VOID ? 0 : startIndex;
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    var tmp;
    var tmp_0;
    if (ignoreCase) {
      tmp_0 = true;
    } else {
      tmp_0 = !(typeof _this__u8e3s4 === 'string');
    }
    if (tmp_0) {
      // Inline function 'kotlin.charArrayOf' call
      var tmp$ret$0 = charArrayOf([char]);
      tmp = indexOfAny(_this__u8e3s4, tmp$ret$0, startIndex, ignoreCase);
    } else {
      // Inline function 'kotlin.text.nativeIndexOf' call
      // Inline function 'kotlin.text.nativeIndexOf' call
      var str = toString(char);
      // Inline function 'kotlin.js.asDynamic' call
      tmp = _this__u8e3s4.indexOf(str, startIndex);
    }
    return tmp;
  }
  function contains_2(_this__u8e3s4, char, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    return indexOf_2(_this__u8e3s4, char, VOID, ignoreCase) >= 0;
  }
  function substringBefore(_this__u8e3s4, delimiter, missingDelimiterValue) {
    missingDelimiterValue = missingDelimiterValue === VOID ? _this__u8e3s4 : missingDelimiterValue;
    var index = indexOf_2(_this__u8e3s4, delimiter);
    return index === -1 ? missingDelimiterValue : substring(_this__u8e3s4, 0, index);
  }
  function substringAfter(_this__u8e3s4, delimiter, missingDelimiterValue) {
    missingDelimiterValue = missingDelimiterValue === VOID ? _this__u8e3s4 : missingDelimiterValue;
    var index = indexOf_2(_this__u8e3s4, delimiter);
    return index === -1 ? missingDelimiterValue : substring(_this__u8e3s4, index + 1 | 0, _this__u8e3s4.length);
  }
  function lastIndexOf(_this__u8e3s4, char, startIndex, ignoreCase) {
    startIndex = startIndex === VOID ? get_lastIndex_1(_this__u8e3s4) : startIndex;
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    var tmp;
    var tmp_0;
    if (ignoreCase) {
      tmp_0 = true;
    } else {
      tmp_0 = !(typeof _this__u8e3s4 === 'string');
    }
    if (tmp_0) {
      // Inline function 'kotlin.charArrayOf' call
      var tmp$ret$0 = charArrayOf([char]);
      tmp = lastIndexOfAny(_this__u8e3s4, tmp$ret$0, startIndex, ignoreCase);
    } else {
      // Inline function 'kotlin.text.nativeLastIndexOf' call
      // Inline function 'kotlin.text.nativeLastIndexOf' call
      var str = toString(char);
      // Inline function 'kotlin.js.asDynamic' call
      tmp = _this__u8e3s4.lastIndexOf(str, startIndex);
    }
    return tmp;
  }
  function indexOf_3(_this__u8e3s4, string, startIndex, ignoreCase) {
    startIndex = startIndex === VOID ? 0 : startIndex;
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    var tmp;
    var tmp_0;
    if (ignoreCase) {
      tmp_0 = true;
    } else {
      tmp_0 = !(typeof _this__u8e3s4 === 'string');
    }
    if (tmp_0) {
      tmp = indexOf_4(_this__u8e3s4, string, startIndex, charSequenceLength(_this__u8e3s4), ignoreCase);
    } else {
      // Inline function 'kotlin.text.nativeIndexOf' call
      // Inline function 'kotlin.js.asDynamic' call
      tmp = _this__u8e3s4.indexOf(string, startIndex);
    }
    return tmp;
  }
  function startsWith_0(_this__u8e3s4, char, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    return charSequenceLength(_this__u8e3s4) > 0 && equals_1(charSequenceGet(_this__u8e3s4, 0), char, ignoreCase);
  }
  function split_0(_this__u8e3s4, delimiters, ignoreCase, limit) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    limit = limit === VOID ? 0 : limit;
    if (delimiters.length === 1) {
      return split_1(_this__u8e3s4, toString(delimiters[0]), ignoreCase, limit);
    }
    // Inline function 'kotlin.collections.map' call
    var this_0 = asIterable(rangesDelimitedBy_0(_this__u8e3s4, delimiters, VOID, ignoreCase, limit));
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = substring_1(_this__u8e3s4, item);
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    return destination;
  }
  function substringBefore_0(_this__u8e3s4, delimiter, missingDelimiterValue) {
    missingDelimiterValue = missingDelimiterValue === VOID ? _this__u8e3s4 : missingDelimiterValue;
    var index = indexOf_3(_this__u8e3s4, delimiter);
    return index === -1 ? missingDelimiterValue : substring(_this__u8e3s4, 0, index);
  }
  function substringAfter_0(_this__u8e3s4, delimiter, missingDelimiterValue) {
    missingDelimiterValue = missingDelimiterValue === VOID ? _this__u8e3s4 : missingDelimiterValue;
    var index = indexOf_3(_this__u8e3s4, delimiter);
    return index === -1 ? missingDelimiterValue : substring(_this__u8e3s4, index + delimiter.length | 0, _this__u8e3s4.length);
  }
  function get_lastIndex_1(_this__u8e3s4) {
    return charSequenceLength(_this__u8e3s4) - 1 | 0;
  }
  function lines(_this__u8e3s4) {
    return toList_2(lineSequence(_this__u8e3s4));
  }
  function removePrefix(_this__u8e3s4, prefix) {
    if (startsWith_1(_this__u8e3s4, prefix)) {
      return substring_0(_this__u8e3s4, charSequenceLength(prefix));
    }
    return _this__u8e3s4;
  }
  function removeSuffix(_this__u8e3s4, suffix) {
    if (endsWith_0(_this__u8e3s4, suffix)) {
      return substring(_this__u8e3s4, 0, _this__u8e3s4.length - charSequenceLength(suffix) | 0);
    }
    return _this__u8e3s4;
  }
  function substringAfterLast(_this__u8e3s4, delimiter, missingDelimiterValue) {
    missingDelimiterValue = missingDelimiterValue === VOID ? _this__u8e3s4 : missingDelimiterValue;
    var index = lastIndexOf(_this__u8e3s4, delimiter);
    return index === -1 ? missingDelimiterValue : substring(_this__u8e3s4, index + 1 | 0, _this__u8e3s4.length);
  }
  function substringBeforeLast(_this__u8e3s4, delimiter, missingDelimiterValue) {
    missingDelimiterValue = missingDelimiterValue === VOID ? _this__u8e3s4 : missingDelimiterValue;
    var index = lastIndexOf(_this__u8e3s4, delimiter);
    return index === -1 ? missingDelimiterValue : substring(_this__u8e3s4, 0, index);
  }
  function padStart_0(_this__u8e3s4, length, padChar) {
    padChar = padChar === VOID ? _Char___init__impl__6a9atx(32) : padChar;
    if (length < 0)
      throw IllegalArgumentException_init_$Create$_0('Desired length ' + length + ' is less than zero.');
    if (length <= charSequenceLength(_this__u8e3s4))
      return charSequenceSubSequence(_this__u8e3s4, 0, charSequenceLength(_this__u8e3s4));
    var sb = StringBuilder_init_$Create$(length);
    var inductionVariable = 1;
    var last = length - charSequenceLength(_this__u8e3s4) | 0;
    if (inductionVariable <= last)
      do {
        var i = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        sb.append_58al37_k$(padChar);
      }
       while (!(i === last));
    sb.append_jgojdo_k$(_this__u8e3s4);
    return sb;
  }
  function indexOf_4(_this__u8e3s4, other, startIndex, endIndex, ignoreCase, last) {
    last = last === VOID ? false : last;
    var indices = !last ? numberRangeToNumber(coerceAtLeast(startIndex, 0), coerceAtMost(endIndex, charSequenceLength(_this__u8e3s4))) : downTo(coerceAtMost(startIndex, get_lastIndex_1(_this__u8e3s4)), coerceAtLeast(endIndex, 0));
    var tmp;
    if (typeof _this__u8e3s4 === 'string') {
      tmp = typeof other === 'string';
    } else {
      tmp = false;
    }
    if (tmp) {
      var inductionVariable = indices.first_1;
      var last_0 = indices.last_1;
      var step = indices.step_1;
      if (step > 0 && inductionVariable <= last_0 || (step < 0 && last_0 <= inductionVariable))
        do {
          var index = inductionVariable;
          inductionVariable = inductionVariable + step | 0;
          if (regionMatches(other, 0, _this__u8e3s4, index, other.length, ignoreCase))
            return index;
        }
         while (!(index === last_0));
    } else {
      var inductionVariable_0 = indices.first_1;
      var last_1 = indices.last_1;
      var step_0 = indices.step_1;
      if (step_0 > 0 && inductionVariable_0 <= last_1 || (step_0 < 0 && last_1 <= inductionVariable_0))
        do {
          var index_0 = inductionVariable_0;
          inductionVariable_0 = inductionVariable_0 + step_0 | 0;
          if (regionMatchesImpl(other, 0, _this__u8e3s4, index_0, charSequenceLength(other), ignoreCase))
            return index_0;
        }
         while (!(index_0 === last_1));
    }
    return -1;
  }
  function split_1(_this__u8e3s4, delimiter, ignoreCase, limit) {
    requireNonNegativeLimit(limit);
    var currentOffset = 0;
    var nextIndex = indexOf_3(_this__u8e3s4, delimiter, currentOffset, ignoreCase);
    if (nextIndex === -1 || limit === 1) {
      return listOf(toString_1(_this__u8e3s4));
    }
    var isLimited = limit > 0;
    var result = ArrayList_init_$Create$_0(isLimited ? coerceAtMost(limit, 10) : 10);
    $l$loop: do {
      var tmp2 = currentOffset;
      // Inline function 'kotlin.text.substring' call
      var endIndex = nextIndex;
      var tmp$ret$0 = toString_1(charSequenceSubSequence(_this__u8e3s4, tmp2, endIndex));
      result.add_utx5q5_k$(tmp$ret$0);
      currentOffset = nextIndex + delimiter.length | 0;
      if (isLimited && result.get_size_woubt6_k$() === (limit - 1 | 0))
        break $l$loop;
      nextIndex = indexOf_3(_this__u8e3s4, delimiter, currentOffset, ignoreCase);
    }
     while (!(nextIndex === -1));
    var tmp2_0 = currentOffset;
    // Inline function 'kotlin.text.substring' call
    var endIndex_0 = charSequenceLength(_this__u8e3s4);
    var tmp$ret$1 = toString_1(charSequenceSubSequence(_this__u8e3s4, tmp2_0, endIndex_0));
    result.add_utx5q5_k$(tmp$ret$1);
    return result;
  }
  function rangesDelimitedBy(_this__u8e3s4, delimiters, startIndex, ignoreCase, limit) {
    startIndex = startIndex === VOID ? 0 : startIndex;
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    limit = limit === VOID ? 0 : limit;
    requireNonNegativeLimit(limit);
    var delimitersList = asList(delimiters);
    return new DelimitedRangesSequence(_this__u8e3s4, startIndex, limit, rangesDelimitedBy$lambda(delimitersList, ignoreCase));
  }
  function substring_1(_this__u8e3s4, range) {
    return toString_1(charSequenceSubSequence(_this__u8e3s4, range.get_start_iypx6h_k$(), range.get_endInclusive_r07xpi_k$() + 1 | 0));
  }
  function indexOfAny(_this__u8e3s4, chars, startIndex, ignoreCase) {
    startIndex = startIndex === VOID ? 0 : startIndex;
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    var tmp;
    if (!ignoreCase && chars.length === 1) {
      tmp = typeof _this__u8e3s4 === 'string';
    } else {
      tmp = false;
    }
    if (tmp) {
      var char = single(chars);
      // Inline function 'kotlin.text.nativeIndexOf' call
      // Inline function 'kotlin.text.nativeIndexOf' call
      var str = toString(char);
      // Inline function 'kotlin.js.asDynamic' call
      return _this__u8e3s4.indexOf(str, startIndex);
    }
    var inductionVariable = coerceAtLeast(startIndex, 0);
    var last = get_lastIndex_1(_this__u8e3s4);
    if (inductionVariable <= last)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        var charAtIndex = charSequenceGet(_this__u8e3s4, index);
        var tmp$ret$3;
        $l$block: {
          // Inline function 'kotlin.collections.any' call
          var inductionVariable_0 = 0;
          var last_0 = chars.length;
          while (inductionVariable_0 < last_0) {
            var element = chars[inductionVariable_0];
            inductionVariable_0 = inductionVariable_0 + 1 | 0;
            if (equals_1(element, charAtIndex, ignoreCase)) {
              tmp$ret$3 = true;
              break $l$block;
            }
          }
          tmp$ret$3 = false;
        }
        if (tmp$ret$3)
          return index;
      }
       while (!(index === last));
    return -1;
  }
  function lastIndexOfAny(_this__u8e3s4, chars, startIndex, ignoreCase) {
    startIndex = startIndex === VOID ? get_lastIndex_1(_this__u8e3s4) : startIndex;
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    var tmp;
    if (!ignoreCase && chars.length === 1) {
      tmp = typeof _this__u8e3s4 === 'string';
    } else {
      tmp = false;
    }
    if (tmp) {
      var char = single(chars);
      // Inline function 'kotlin.text.nativeLastIndexOf' call
      // Inline function 'kotlin.text.nativeLastIndexOf' call
      var str = toString(char);
      // Inline function 'kotlin.js.asDynamic' call
      return _this__u8e3s4.lastIndexOf(str, startIndex);
    }
    var inductionVariable = coerceAtMost(startIndex, get_lastIndex_1(_this__u8e3s4));
    if (0 <= inductionVariable)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + -1 | 0;
        var charAtIndex = charSequenceGet(_this__u8e3s4, index);
        var tmp$ret$3;
        $l$block: {
          // Inline function 'kotlin.collections.any' call
          var inductionVariable_0 = 0;
          var last = chars.length;
          while (inductionVariable_0 < last) {
            var element = chars[inductionVariable_0];
            inductionVariable_0 = inductionVariable_0 + 1 | 0;
            if (equals_1(element, charAtIndex, ignoreCase)) {
              tmp$ret$3 = true;
              break $l$block;
            }
          }
          tmp$ret$3 = false;
        }
        if (tmp$ret$3)
          return index;
      }
       while (0 <= inductionVariable);
    return -1;
  }
  function rangesDelimitedBy_0(_this__u8e3s4, delimiters, startIndex, ignoreCase, limit) {
    startIndex = startIndex === VOID ? 0 : startIndex;
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    limit = limit === VOID ? 0 : limit;
    requireNonNegativeLimit(limit);
    return new DelimitedRangesSequence(_this__u8e3s4, startIndex, limit, rangesDelimitedBy$lambda_0(delimiters, ignoreCase));
  }
  function trim(_this__u8e3s4) {
    // Inline function 'kotlin.text.trim' call
    var startIndex = 0;
    var endIndex = charSequenceLength(_this__u8e3s4) - 1 | 0;
    var startFound = false;
    $l$loop: while (startIndex <= endIndex) {
      var index = !startFound ? startIndex : endIndex;
      var p0 = charSequenceGet(_this__u8e3s4, index);
      var match = isWhitespace(p0);
      if (!startFound) {
        if (!match)
          startFound = true;
        else
          startIndex = startIndex + 1 | 0;
      } else {
        if (!match)
          break $l$loop;
        else
          endIndex = endIndex - 1 | 0;
      }
    }
    return charSequenceSubSequence(_this__u8e3s4, startIndex, endIndex + 1 | 0);
  }
  function lineSequence(_this__u8e3s4) {
    // Inline function 'kotlin.sequences.Sequence' call
    return new lineSequence$$inlined$Sequence$1(_this__u8e3s4);
  }
  function startsWith_1(_this__u8e3s4, prefix, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    var tmp;
    var tmp_0;
    if (!ignoreCase) {
      tmp_0 = typeof _this__u8e3s4 === 'string';
    } else {
      tmp_0 = false;
    }
    if (tmp_0) {
      tmp = typeof prefix === 'string';
    } else {
      tmp = false;
    }
    if (tmp)
      return startsWith(_this__u8e3s4, prefix);
    else {
      return regionMatchesImpl(_this__u8e3s4, 0, prefix, 0, charSequenceLength(prefix), ignoreCase);
    }
  }
  function trimStart(_this__u8e3s4) {
    var tmp$ret$0;
    $l$block: {
      // Inline function 'kotlin.text.trimStart' call
      var inductionVariable = 0;
      var last = charSequenceLength(_this__u8e3s4) - 1 | 0;
      if (inductionVariable <= last)
        do {
          var index = inductionVariable;
          inductionVariable = inductionVariable + 1 | 0;
          var p0 = charSequenceGet(_this__u8e3s4, index);
          if (!isWhitespace(p0)) {
            tmp$ret$0 = charSequenceSubSequence(_this__u8e3s4, index, charSequenceLength(_this__u8e3s4));
            break $l$block;
          }
        }
         while (inductionVariable <= last);
      tmp$ret$0 = '';
    }
    return tmp$ret$0;
  }
  function endsWith_0(_this__u8e3s4, suffix, ignoreCase) {
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    var tmp;
    var tmp_0;
    if (!ignoreCase) {
      tmp_0 = typeof _this__u8e3s4 === 'string';
    } else {
      tmp_0 = false;
    }
    if (tmp_0) {
      tmp = typeof suffix === 'string';
    } else {
      tmp = false;
    }
    if (tmp)
      return endsWith(_this__u8e3s4, suffix);
    else {
      return regionMatchesImpl(_this__u8e3s4, charSequenceLength(_this__u8e3s4) - charSequenceLength(suffix) | 0, suffix, 0, charSequenceLength(suffix), ignoreCase);
    }
  }
  function regionMatchesImpl(_this__u8e3s4, thisOffset, other, otherOffset, length, ignoreCase) {
    if (otherOffset < 0 || thisOffset < 0 || thisOffset > (charSequenceLength(_this__u8e3s4) - length | 0) || otherOffset > (charSequenceLength(other) - length | 0)) {
      return false;
    }
    var inductionVariable = 0;
    if (inductionVariable < length)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        if (!equals_1(charSequenceGet(_this__u8e3s4, thisOffset + index | 0), charSequenceGet(other, otherOffset + index | 0), ignoreCase))
          return false;
      }
       while (inductionVariable < length);
    return true;
  }
  function requireNonNegativeLimit(limit) {
    // Inline function 'kotlin.require' call
    if (!(limit >= 0)) {
      var message = 'Limit must be non-negative, but was ' + limit;
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    return Unit_instance;
  }
  function calcNext($this) {
    if ($this.nextSearchIndex_1 < 0) {
      $this.nextState_1 = 0;
      $this.nextItem_1 = null;
    } else {
      var tmp;
      var tmp_0;
      if ($this.this$0__1.limit_1 > 0) {
        $this.counter_1 = $this.counter_1 + 1 | 0;
        tmp_0 = $this.counter_1 >= $this.this$0__1.limit_1;
      } else {
        tmp_0 = false;
      }
      if (tmp_0) {
        tmp = true;
      } else {
        tmp = $this.nextSearchIndex_1 > charSequenceLength($this.this$0__1.input_1);
      }
      if (tmp) {
        $this.nextItem_1 = numberRangeToNumber($this.currentStartIndex_1, get_lastIndex_1($this.this$0__1.input_1));
        $this.nextSearchIndex_1 = -1;
      } else {
        var match = $this.this$0__1.getNextMatch_1($this.this$0__1.input_1, $this.nextSearchIndex_1);
        if (match == null) {
          $this.nextItem_1 = numberRangeToNumber($this.currentStartIndex_1, get_lastIndex_1($this.this$0__1.input_1));
          $this.nextSearchIndex_1 = -1;
        } else {
          var index = match.component1_7eebsc_k$();
          var length = match.component2_7eebsb_k$();
          $this.nextItem_1 = until($this.currentStartIndex_1, index);
          $this.currentStartIndex_1 = index + length | 0;
          $this.nextSearchIndex_1 = $this.currentStartIndex_1 + (length === 0 ? 1 : 0) | 0;
        }
      }
      $this.nextState_1 = 1;
    }
  }
  function DelimitedRangesSequence$iterator$1(this$0) {
    this.this$0__1 = this$0;
    this.nextState_1 = -1;
    this.currentStartIndex_1 = coerceIn_0(this$0.startIndex_1, 0, charSequenceLength(this$0.input_1));
    this.nextSearchIndex_1 = this.currentStartIndex_1;
    this.nextItem_1 = null;
    this.counter_1 = 0;
  }
  protoOf(DelimitedRangesSequence$iterator$1).next_20eer_k$ = function () {
    if (this.nextState_1 === -1) {
      calcNext(this);
    }
    if (this.nextState_1 === 0)
      throw NoSuchElementException_init_$Create$();
    var tmp = this.nextItem_1;
    var result = tmp instanceof IntRange ? tmp : THROW_CCE();
    this.nextItem_1 = null;
    this.nextState_1 = -1;
    return result;
  };
  protoOf(DelimitedRangesSequence$iterator$1).hasNext_bitz1p_k$ = function () {
    if (this.nextState_1 === -1) {
      calcNext(this);
    }
    return this.nextState_1 === 1;
  };
  function DelimitedRangesSequence(input, startIndex, limit, getNextMatch) {
    this.input_1 = input;
    this.startIndex_1 = startIndex;
    this.limit_1 = limit;
    this.getNextMatch_1 = getNextMatch;
  }
  protoOf(DelimitedRangesSequence).iterator_jk1svi_k$ = function () {
    return new DelimitedRangesSequence$iterator$1(this);
  };
  function findAnyOf(_this__u8e3s4, strings, startIndex, ignoreCase, last) {
    if (!ignoreCase && strings.get_size_woubt6_k$() === 1) {
      var string = single_0(strings);
      var index = !last ? indexOf_3(_this__u8e3s4, string, startIndex) : lastIndexOf_0(_this__u8e3s4, string, startIndex);
      return index < 0 ? null : to(index, string);
    }
    var indices = !last ? numberRangeToNumber(coerceAtLeast(startIndex, 0), charSequenceLength(_this__u8e3s4)) : downTo(coerceAtMost(startIndex, get_lastIndex_1(_this__u8e3s4)), 0);
    if (typeof _this__u8e3s4 === 'string') {
      var inductionVariable = indices.first_1;
      var last_0 = indices.last_1;
      var step = indices.step_1;
      if (step > 0 && inductionVariable <= last_0 || (step < 0 && last_0 <= inductionVariable))
        do {
          var index_0 = inductionVariable;
          inductionVariable = inductionVariable + step | 0;
          var tmp$ret$0;
          $l$block: {
            // Inline function 'kotlin.collections.firstOrNull' call
            var _iterator__ex2g4s = strings.iterator_jk1svi_k$();
            while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
              var element = _iterator__ex2g4s.next_20eer_k$();
              if (regionMatches(element, 0, _this__u8e3s4, index_0, element.length, ignoreCase)) {
                tmp$ret$0 = element;
                break $l$block;
              }
            }
            tmp$ret$0 = null;
          }
          var matchingString = tmp$ret$0;
          if (!(matchingString == null))
            return to(index_0, matchingString);
        }
         while (!(index_0 === last_0));
    } else {
      var inductionVariable_0 = indices.first_1;
      var last_1 = indices.last_1;
      var step_0 = indices.step_1;
      if (step_0 > 0 && inductionVariable_0 <= last_1 || (step_0 < 0 && last_1 <= inductionVariable_0))
        do {
          var index_1 = inductionVariable_0;
          inductionVariable_0 = inductionVariable_0 + step_0 | 0;
          var tmp$ret$2;
          $l$block_0: {
            // Inline function 'kotlin.collections.firstOrNull' call
            var _iterator__ex2g4s_0 = strings.iterator_jk1svi_k$();
            while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
              var element_0 = _iterator__ex2g4s_0.next_20eer_k$();
              if (regionMatchesImpl(element_0, 0, _this__u8e3s4, index_1, element_0.length, ignoreCase)) {
                tmp$ret$2 = element_0;
                break $l$block_0;
              }
            }
            tmp$ret$2 = null;
          }
          var matchingString_0 = tmp$ret$2;
          if (!(matchingString_0 == null))
            return to(index_1, matchingString_0);
        }
         while (!(index_1 === last_1));
    }
    return null;
  }
  function State() {
    this.UNKNOWN_1 = 0;
    this.HAS_NEXT_1 = 1;
    this.EXHAUSTED_1 = 2;
  }
  var State_instance;
  function State_getInstance() {
    return State_instance;
  }
  function LinesIterator(string) {
    this.string_1 = string;
    this.state_1 = 0;
    this.tokenStartIndex_1 = 0;
    this.delimiterStartIndex_1 = 0;
    this.delimiterLength_1 = 0;
  }
  protoOf(LinesIterator).hasNext_bitz1p_k$ = function () {
    if (!(this.state_1 === 0)) {
      return this.state_1 === 1;
    }
    if (this.delimiterLength_1 < 0) {
      this.state_1 = 2;
      return false;
    }
    var _delimiterLength = -1;
    var _delimiterStartIndex = charSequenceLength(this.string_1);
    var inductionVariable = this.tokenStartIndex_1;
    var last = charSequenceLength(this.string_1);
    if (inductionVariable < last)
      $l$loop: do {
        var idx = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        var c = charSequenceGet(this.string_1, idx);
        if (c === _Char___init__impl__6a9atx(10) || c === _Char___init__impl__6a9atx(13)) {
          _delimiterLength = c === _Char___init__impl__6a9atx(13) && (idx + 1 | 0) < charSequenceLength(this.string_1) && charSequenceGet(this.string_1, idx + 1 | 0) === _Char___init__impl__6a9atx(10) ? 2 : 1;
          _delimiterStartIndex = idx;
          break $l$loop;
        }
      }
       while (inductionVariable < last);
    this.state_1 = 1;
    this.delimiterLength_1 = _delimiterLength;
    this.delimiterStartIndex_1 = _delimiterStartIndex;
    return true;
  };
  protoOf(LinesIterator).next_20eer_k$ = function () {
    if (!this.hasNext_bitz1p_k$()) {
      throw NoSuchElementException_init_$Create$();
    }
    this.state_1 = 0;
    var lastIndex = this.delimiterStartIndex_1;
    var firstIndex = this.tokenStartIndex_1;
    this.tokenStartIndex_1 = this.delimiterStartIndex_1 + this.delimiterLength_1 | 0;
    // Inline function 'kotlin.text.substring' call
    var this_0 = this.string_1;
    return toString_1(charSequenceSubSequence(this_0, firstIndex, lastIndex));
  };
  function lastIndexOf_0(_this__u8e3s4, string, startIndex, ignoreCase) {
    startIndex = startIndex === VOID ? get_lastIndex_1(_this__u8e3s4) : startIndex;
    ignoreCase = ignoreCase === VOID ? false : ignoreCase;
    var tmp;
    var tmp_0;
    if (ignoreCase) {
      tmp_0 = true;
    } else {
      tmp_0 = !(typeof _this__u8e3s4 === 'string');
    }
    if (tmp_0) {
      tmp = indexOf_4(_this__u8e3s4, string, startIndex, 0, ignoreCase, true);
    } else {
      // Inline function 'kotlin.text.nativeLastIndexOf' call
      // Inline function 'kotlin.js.asDynamic' call
      tmp = _this__u8e3s4.lastIndexOf(string, startIndex);
    }
    return tmp;
  }
  function iterator$1($this_iterator) {
    this.$this_iterator_1 = $this_iterator;
    CharIterator.call(this);
    this.index_1 = 0;
  }
  protoOf(iterator$1).nextChar_yvnk6j_k$ = function () {
    var _unary__edvuaz = this.index_1;
    this.index_1 = _unary__edvuaz + 1 | 0;
    return charSequenceGet(this.$this_iterator_1, _unary__edvuaz);
  };
  protoOf(iterator$1).hasNext_bitz1p_k$ = function () {
    return this.index_1 < charSequenceLength(this.$this_iterator_1);
  };
  function rangesDelimitedBy$lambda($delimitersList, $ignoreCase) {
    return function ($this$DelimitedRangesSequence, currentIndex) {
      var tmp0_safe_receiver = findAnyOf($this$DelimitedRangesSequence, $delimitersList, currentIndex, $ignoreCase, false);
      var tmp;
      if (tmp0_safe_receiver == null) {
        tmp = null;
      } else {
        // Inline function 'kotlin.let' call
        tmp = to(tmp0_safe_receiver.first_1, tmp0_safe_receiver.second_1.length);
      }
      return tmp;
    };
  }
  function rangesDelimitedBy$lambda_0($delimiters, $ignoreCase) {
    return function ($this$DelimitedRangesSequence, currentIndex) {
      // Inline function 'kotlin.let' call
      var it = indexOfAny($this$DelimitedRangesSequence, $delimiters, currentIndex, $ignoreCase);
      return it < 0 ? null : to(it, 1);
    };
  }
  function lineSequence$$inlined$Sequence$1($this_lineSequence) {
    this.$this_lineSequence_1 = $this_lineSequence;
  }
  protoOf(lineSequence$$inlined$Sequence$1).iterator_jk1svi_k$ = function () {
    return new LinesIterator(this.$this_lineSequence_1);
  };
  function UnsafeLazyImpl(initializer) {
    this.initializer_1 = initializer;
    this._value_1 = UNINITIALIZED_VALUE_instance;
  }
  protoOf(UnsafeLazyImpl).get_value_j01efc_k$ = function () {
    if (this._value_1 === UNINITIALIZED_VALUE_instance) {
      this._value_1 = ensureNotNull(this.initializer_1)();
      this.initializer_1 = null;
    }
    return this._value_1;
  };
  protoOf(UnsafeLazyImpl).isInitialized_2wsk3a_k$ = function () {
    return !(this._value_1 === UNINITIALIZED_VALUE_instance);
  };
  protoOf(UnsafeLazyImpl).toString = function () {
    return this.isInitialized_2wsk3a_k$() ? toString_0(this.get_value_j01efc_k$()) : 'Lazy value not initialized yet.';
  };
  function UNINITIALIZED_VALUE() {
  }
  var UNINITIALIZED_VALUE_instance;
  function UNINITIALIZED_VALUE_getInstance() {
    return UNINITIALIZED_VALUE_instance;
  }
  function Pair(first, second) {
    this.first_1 = first;
    this.second_1 = second;
  }
  protoOf(Pair).toString = function () {
    return '(' + toString_0(this.first_1) + ', ' + toString_0(this.second_1) + ')';
  };
  protoOf(Pair).component1_7eebsc_k$ = function () {
    return this.first_1;
  };
  protoOf(Pair).component2_7eebsb_k$ = function () {
    return this.second_1;
  };
  protoOf(Pair).hashCode = function () {
    var result = this.first_1 == null ? 0 : hashCode_0(this.first_1);
    result = imul(result, 31) + (this.second_1 == null ? 0 : hashCode_0(this.second_1)) | 0;
    return result;
  };
  protoOf(Pair).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof Pair))
      return false;
    if (!equals(this.first_1, other.first_1))
      return false;
    if (!equals(this.second_1, other.second_1))
      return false;
    return true;
  };
  function to(_this__u8e3s4, that) {
    return new Pair(_this__u8e3s4, that);
  }
  function Triple(first, second, third) {
    this.first_1 = first;
    this.second_1 = second;
    this.third_1 = third;
  }
  protoOf(Triple).toString = function () {
    return '(' + toString_0(this.first_1) + ', ' + toString_0(this.second_1) + ', ' + toString_0(this.third_1) + ')';
  };
  protoOf(Triple).hashCode = function () {
    var result = this.first_1 == null ? 0 : hashCode_0(this.first_1);
    result = imul(result, 31) + (this.second_1 == null ? 0 : hashCode_0(this.second_1)) | 0;
    result = imul(result, 31) + (this.third_1 == null ? 0 : hashCode_0(this.third_1)) | 0;
    return result;
  };
  protoOf(Triple).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof Triple))
      return false;
    if (!equals(this.first_1, other.first_1))
      return false;
    if (!equals(this.second_1, other.second_1))
      return false;
    if (!equals(this.third_1, other.third_1))
      return false;
    return true;
  };
  function _UShort___init__impl__jigrne(data) {
    return data;
  }
  function _UShort___get_data__impl__g0245($this) {
    return $this;
  }
  var static_init_called;
  function static_init() {
    if (static_init_called)
      return Unit_instance;
    static_init_called = true;
    ArchiveFormat_BROWSER_instance = new ArchiveFormat('BROWSER', 0);
    ArchiveFormat_ANDROID_instance = new ArchiveFormat('ANDROID', 1);
  }
  var ArchiveFormat_BROWSER_instance;
  var ArchiveFormat_ANDROID_instance;
  function ArchiveFormat(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function ArchiveRequest(url, mode, source, days, start, end, now, correction, programmeId, base, username, password, streamId, extension, live, channelId, epgId, channelName, resourceName) {
    source = source === VOID ? '' : source;
    days = days === VOID ? 0.0 : days;
    correction = correction === VOID ? 0.0 : correction;
    programmeId = programmeId === VOID ? '' : programmeId;
    base = base === VOID ? '' : base;
    username = username === VOID ? null : username;
    password = password === VOID ? null : password;
    streamId = streamId === VOID ? '' : streamId;
    extension = extension === VOID ? '' : extension;
    live = live === VOID ? true : live;
    channelId = channelId === VOID ? '' : channelId;
    epgId = epgId === VOID ? '' : epgId;
    channelName = channelName === VOID ? '' : channelName;
    resourceName = resourceName === VOID ? null : resourceName;
    this.url_1 = url;
    this.mode_1 = mode;
    this.source_1 = source;
    this.days_1 = days;
    this.start_1 = start;
    this.end_1 = end;
    this.now_1 = now;
    this.correction_1 = correction;
    this.programmeId_1 = programmeId;
    this.base_1 = base;
    this.username_1 = username;
    this.password_1 = password;
    this.streamId_1 = streamId;
    this.extension_1 = extension;
    this.live_1 = live;
    this.channelId_1 = channelId;
    this.epgId_1 = epgId;
    this.channelName_1 = channelName;
    this.resourceName_1 = resourceName;
  }
  protoOf(ArchiveRequest).toString = function () {
    return 'ArchiveRequest(url=' + this.url_1 + ', mode=' + this.mode_1 + ', source=' + this.source_1 + ', days=' + this.days_1 + ', start=' + this.start_1 + ', end=' + this.end_1 + ', now=' + this.now_1 + ', correction=' + this.correction_1 + ', programmeId=' + this.programmeId_1 + ', base=' + this.base_1 + ', username=' + this.username_1 + ', password=' + this.password_1 + ', streamId=' + this.streamId_1 + ', extension=' + this.extension_1 + ', live=' + this.live_1 + ', channelId=' + this.channelId_1 + ', epgId=' + this.epgId_1 + ', channelName=' + this.channelName_1 + ', resourceName=' + this.resourceName_1 + ')';
  };
  protoOf(ArchiveRequest).hashCode = function () {
    var result = getStringHashCode(this.url_1);
    result = imul(result, 31) + getStringHashCode(this.mode_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.source_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.days_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.start_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.end_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.now_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.correction_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.programmeId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.base_1) | 0;
    result = imul(result, 31) + (this.username_1 == null ? 0 : getStringHashCode(this.username_1)) | 0;
    result = imul(result, 31) + (this.password_1 == null ? 0 : getStringHashCode(this.password_1)) | 0;
    result = imul(result, 31) + getStringHashCode(this.streamId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.extension_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.live_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.channelId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.epgId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.channelName_1) | 0;
    result = imul(result, 31) + (this.resourceName_1 == null ? 0 : getStringHashCode(this.resourceName_1)) | 0;
    return result;
  };
  protoOf(ArchiveRequest).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof ArchiveRequest))
      return false;
    if (!(this.url_1 === other.url_1))
      return false;
    if (!(this.mode_1 === other.mode_1))
      return false;
    if (!(this.source_1 === other.source_1))
      return false;
    if (!equals(this.days_1, other.days_1))
      return false;
    if (!equals(this.start_1, other.start_1))
      return false;
    if (!equals(this.end_1, other.end_1))
      return false;
    if (!equals(this.now_1, other.now_1))
      return false;
    if (!equals(this.correction_1, other.correction_1))
      return false;
    if (!(this.programmeId_1 === other.programmeId_1))
      return false;
    if (!(this.base_1 === other.base_1))
      return false;
    if (!(this.username_1 == other.username_1))
      return false;
    if (!(this.password_1 == other.password_1))
      return false;
    if (!(this.streamId_1 === other.streamId_1))
      return false;
    if (!(this.extension_1 === other.extension_1))
      return false;
    if (!(this.live_1 === other.live_1))
      return false;
    if (!(this.channelId_1 === other.channelId_1))
      return false;
    if (!(this.epgId_1 === other.epgId_1))
      return false;
    if (!(this.channelName_1 === other.channelName_1))
      return false;
    if (!(this.resourceName_1 == other.resourceName_1))
      return false;
    return true;
  };
  function values$lambda($date$delegate) {
    // Inline function 'kotlin.getValue' call
    getLocalDelegateReference('date', KProperty0, false);
    return $date$delegate.get_value_j01efc_k$();
  }
  function Archive$Span$values$lambda($calendar, $corrected) {
    return function () {
      return $calendar($corrected);
    };
  }
  function Archive$Span$values$1($result, $date$delegate) {
    this.$result_1 = $result;
    this.$date$delegate_1 = $date$delegate;
    this.$$delegate_0__1 = $result;
  }
  protoOf(Archive$Span$values$1).get_6bo4tg_k$ = function (key) {
    var index = listOf_0(['Y', 'm', 'd', 'H', 'M', 'S']).indexOf_si1fv9_k$(key);
    if (index >= 0) {
      var tmp0_safe_receiver = getOrNull_0(values$lambda(this.$date$delegate_1), index);
      var tmp;
      if (tmp0_safe_receiver == null) {
        tmp = null;
      } else {
        // Inline function 'kotlin.let' call
        tmp = index === 0 ? tmp0_safe_receiver.toString() : pad(Archive_getInstance(), tmp0_safe_receiver);
      }
      return tmp;
    }
    if (key === 'startDate')
      return values$lambda(this.$date$delegate_1).get_size_woubt6_k$() === 6 ? padStart(values$lambda(this.$date$delegate_1).get_c1px32_k$(0).toString(), 4, _Char___init__impl__6a9atx(48)) + '-' + pad(Archive_getInstance(), values$lambda(this.$date$delegate_1).get_c1px32_k$(1)) + '-' + pad(Archive_getInstance(), values$lambda(this.$date$delegate_1).get_c1px32_k$(2)) + ':' + pad(Archive_getInstance(), values$lambda(this.$date$delegate_1).get_c1px32_k$(3)) + '-' + pad(Archive_getInstance(), values$lambda(this.$date$delegate_1).get_c1px32_k$(4)) : null;
    return this.$result_1.get_wei43m_k$(key);
  };
  protoOf(Archive$Span$values$1).get_wei43m_k$ = function (key) {
    if (!(!(key == null) ? typeof key === 'string' : false))
      return null;
    return this.get_6bo4tg_k$((!(key == null) ? typeof key === 'string' : false) ? key : THROW_CCE());
  };
  protoOf(Archive$Span$values$1).isEmpty_y1axqb_k$ = function () {
    return this.$$delegate_0__1.isEmpty_y1axqb_k$();
  };
  protoOf(Archive$Span$values$1).containsKey_w445h6_k$ = function (key) {
    return this.$$delegate_0__1.containsKey_aw81wo_k$(key);
  };
  protoOf(Archive$Span$values$1).containsKey_aw81wo_k$ = function (key) {
    if (!(!(key == null) ? typeof key === 'string' : false))
      return false;
    return this.containsKey_w445h6_k$((!(key == null) ? typeof key === 'string' : false) ? key : THROW_CCE());
  };
  protoOf(Archive$Span$values$1).get_size_woubt6_k$ = function () {
    return this.$$delegate_0__1.get_size_woubt6_k$();
  };
  protoOf(Archive$Span$values$1).get_keys_wop4xp_k$ = function () {
    return this.$$delegate_0__1.get_keys_wop4xp_k$();
  };
  protoOf(Archive$Span$values$1).get_values_ksazhn_k$ = function () {
    return this.$$delegate_0__1.get_values_ksazhn_k$();
  };
  protoOf(Archive$Span$values$1).get_entries_p20ztl_k$ = function () {
    return this.$$delegate_0__1.get_entries_p20ztl_k$();
  };
  var static_init_called_0;
  function static_init_0() {
    if (static_init_called_0)
      return Unit_instance;
    static_init_called_0 = true;
    TemplateFormat_BROWSER_instance = new TemplateFormat('BROWSER', 0);
    TemplateFormat_MODERN_instance = new TemplateFormat('MODERN', 1);
    TemplateFormat_PROVIDER_instance = new TemplateFormat('PROVIDER', 2);
  }
  var TemplateFormat_BROWSER_instance;
  var TemplateFormat_MODERN_instance;
  var TemplateFormat_PROVIDER_instance;
  function Span(start, end, now) {
    this.start_1 = start;
    this.end_1 = end;
    this.now_1 = now;
  }
  protoOf(Span).get_duration_6a6kpp_k$ = function () {
    // Inline function 'kotlin.math.floor' call
    var x = this.end_1 - this.start_1;
    return Math.floor(x);
  };
  protoOf(Span).values_80k4nh_k$ = function (calendar, corrected, correctedEnd) {
    var date$delegate = lazy(Archive$Span$values$lambda(calendar, corrected));
    var tmp = to('start', integer(Archive_getInstance(), corrected));
    var tmp_0 = to('utc', integer(Archive_getInstance(), corrected));
    var tmp_1 = to('end', integer(Archive_getInstance(), correctedEnd));
    var tmp_2 = to('utcend', integer(Archive_getInstance(), correctedEnd));
    var tmp_3 = to('now', integer(Archive_getInstance(), this.now_1));
    var tmp_4 = to('timestamp', integer(Archive_getInstance(), this.now_1));
    var tmp_5 = to('lutc', integer(Archive_getInstance(), this.now_1));
    var tmp_6 = to('duration', integer(Archive_getInstance(), this.get_duration_6a6kpp_k$()));
    var tmp_7 = to('offset', integer(Archive_getInstance(), this.now_1 - this.start_1));
    var tmp_8 = Archive_getInstance();
    // Inline function 'kotlin.math.ceil' call
    var x = this.get_duration_6a6kpp_k$() / 60;
    var tmp$ret$0 = Math.ceil(x);
    var result = mutableMapOf([tmp, tmp_0, tmp_1, tmp_2, tmp_3, tmp_4, tmp_5, tmp_6, tmp_7, to('durationMinutes', integer(tmp_8, tmp$ret$0))]);
    return new Archive$Span$values$1(result, date$delegate);
  };
  protoOf(Span).values$default_ntia98_k$ = function (calendar, corrected, correctedEnd, $super) {
    corrected = corrected === VOID ? this.start_1 : corrected;
    correctedEnd = correctedEnd === VOID ? this.end_1 : correctedEnd;
    return $super === VOID ? this.values_80k4nh_k$(calendar, corrected, correctedEnd) : $super.values_80k4nh_k$.call(this, calendar, corrected, correctedEnd);
  };
  protoOf(Span).toString = function () {
    return 'Span(start=' + this.start_1 + ', end=' + this.end_1 + ', now=' + this.now_1 + ')';
  };
  protoOf(Span).hashCode = function () {
    var result = getNumberHashCode(this.start_1);
    result = imul(result, 31) + getNumberHashCode(this.end_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.now_1) | 0;
    return result;
  };
  protoOf(Span).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof Span))
      return false;
    if (!equals(this.start_1, other.start_1))
      return false;
    if (!equals(this.end_1, other.end_1))
      return false;
    if (!equals(this.now_1, other.now_1))
      return false;
    return true;
  };
  function TemplateFormat(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function expand($this, template, values, format, programmeId) {
    programmeId = programmeId === VOID ? '' : programmeId;
    var output = StringBuilder_init_$Create$_0();
    var at = 0;
    var identifies = false;
    $l$loop_0: while (at < template.length) {
      var tmp;
      if (charCodeAt(template, at) === _Char___init__impl__6a9atx(36)) {
        var tmp_0 = getOrNull_1(template, at + 1 | 0);
        tmp = equals(tmp_0 == null ? null : new Char(tmp_0), new Char(_Char___init__impl__6a9atx(123)));
      } else {
        tmp = false;
      }
      var dollar = tmp;
      var open = dollar ? at + 1 | 0 : at;
      if (!(charCodeAt(template, open) === _Char___init__impl__6a9atx(123)) || (format.equals(TemplateFormat_PROVIDER_getInstance()) && !dollar)) {
        var _unary__edvuaz = at;
        at = _unary__edvuaz + 1 | 0;
        output.append_58al37_k$(charCodeAt(template, _unary__edvuaz));
        continue $l$loop_0;
      }
      var close = indexOf_2(template, _Char___init__impl__6a9atx(125), open + 1 | 0);
      if (close < 0) {
        output.append_22ad7x_k$(substring_0(template, at));
        break $l$loop_0;
      }
      var key = substring(template, open + 1 | 0, close);
      var tmp_1;
      switch (format.ordinal_1) {
        case 2:
          tmp_1 = listOf_0(['start', 'end', 'timestamp', 'offset', 'duration']).contains_aljjnj_k$(key);
          break;
        case 1:
          tmp_1 = listOf_0(['start', 'utc', 'end', 'utcend', 'timestamp', 'lutc', 'offset', 'duration', 'durationMinutes', 'startDate']).contains_aljjnj_k$(key);
          break;
        case 0:
          tmp_1 = !listOf_0(['durationMinutes', 'startDate']).contains_aljjnj_k$(key);
          break;
        default:
          noWhenBranchMatchedException();
          break;
      }
      var allowed = tmp_1;
      var value = allowed ? values.get_wei43m_k$(key) : null;
      if (format.equals(TemplateFormat_BROWSER_getInstance()) && key === 'catchup-id') {
        // Inline function 'kotlin.takeIf' call
        var tmp_2;
        // Inline function 'kotlin.text.isNotEmpty' call
        if (charSequenceLength(programmeId) > 0) {
          tmp_2 = programmeId;
        } else {
          tmp_2 = null;
        }
        var tmp1_safe_receiver = tmp_2;
        var tmp_3;
        if (tmp1_safe_receiver == null) {
          tmp_3 = null;
        } else {
          // Inline function 'kotlin.let' call
          tmp_3 = component($this, tmp1_safe_receiver);
        }
        value = tmp_3;
        identifies = true;
      } else if (format.equals(TemplateFormat_BROWSER_getInstance()) && contains_2(key, _Char___init__impl__6a9atx(58))) {
        var field = substringBefore(key, _Char___init__impl__6a9atx(58));
        var divisor = substringAfter(key, _Char___init__impl__6a9atx(58));
        var tmp_4;
        var tmp_5;
        if (listOf_0(['duration', 'offset']).contains_aljjnj_k$(field)) {
          var tmp0 = Char__rangeTo_impl_tkncvp(_Char___init__impl__6a9atx(49), _Char___init__impl__6a9atx(57));
          // Inline function 'kotlin.ranges.contains' call
          var element = firstOrNull_0(divisor);
          var tmp_6;
          var tmp_7 = element;
          if (!((tmp_7 == null ? null : new Char(tmp_7)) == null)) {
            tmp_6 = tmp0.contains_egozq6_k$(element);
          } else {
            tmp_6 = false;
          }
          tmp_5 = tmp_6;
        } else {
          tmp_5 = false;
        }
        if (tmp_5) {
          var tmp$ret$6;
          $l$block: {
            // Inline function 'kotlin.text.all' call
            var inductionVariable = 0;
            while (inductionVariable < charSequenceLength(divisor)) {
              var element_0 = charSequenceGet(divisor, inductionVariable);
              inductionVariable = inductionVariable + 1 | 0;
              if (!(_Char___init__impl__6a9atx(48) <= element_0 ? element_0 <= _Char___init__impl__6a9atx(57) : false)) {
                tmp$ret$6 = false;
                break $l$block;
              }
            }
            tmp$ret$6 = true;
          }
          tmp_4 = tmp$ret$6;
        } else {
          tmp_4 = false;
        }
        if (tmp_4) {
          var tmp2_safe_receiver = values.get_wei43m_k$(field);
          var tmp3_safe_receiver = tmp2_safe_receiver == null ? null : toDoubleOrNull(tmp2_safe_receiver);
          var tmp_8;
          if (tmp3_safe_receiver == null) {
            tmp_8 = null;
          } else {
            // Inline function 'kotlin.let' call
            var tmp_9 = Archive_getInstance();
            var tmp0_elvis_lhs = toDoubleOrNull(divisor);
            // Inline function 'kotlin.math.floor' call
            var x = tmp3_safe_receiver / (tmp0_elvis_lhs == null ? Infinity : tmp0_elvis_lhs);
            var tmp$ret$10 = Math.floor(x);
            tmp_8 = integer(tmp_9, tmp$ret$10);
          }
          value = tmp_8;
          if (field === 'offset')
            identifies = true;
        }
      }
      if (listOf_0(['utc', 'start', 'offset', 'Y', 'm', 'd', 'H', 'M', 'S']).contains_aljjnj_k$(key))
        identifies = true;
      if (value == null) {
        if (!format.equals(TemplateFormat_PROVIDER_getInstance()))
          return null;
        output.append_22ad7x_k$(substring(template, at, close + 1 | 0));
      } else
        output.append_22ad7x_k$(value);
      at = close + 1 | 0;
    }
    var result = output.toString();
    var tmp_10;
    if (format.equals(TemplateFormat_BROWSER_getInstance())) {
      var tmp_11;
      if (!identifies) {
        tmp_11 = true;
      } else {
        var tmp$ret$11;
        $l$block_0: {
          // Inline function 'kotlin.text.any' call
          var inductionVariable_0 = 0;
          while (inductionVariable_0 < charSequenceLength(result)) {
            var element_1 = charSequenceGet(result, inductionVariable_0);
            inductionVariable_0 = inductionVariable_0 + 1 | 0;
            if (element_1 === _Char___init__impl__6a9atx(123) || element_1 === _Char___init__impl__6a9atx(125)) {
              tmp$ret$11 = true;
              break $l$block_0;
            }
          }
          tmp$ret$11 = false;
        }
        tmp_11 = tmp$ret$11;
      }
      tmp_10 = tmp_11;
    } else {
      tmp_10 = false;
    }
    if (tmp_10)
      return null;
    return result;
  }
  function legacyValues($this, start, end, now) {
    var tmp = to('start', integer($this, start));
    var tmp_0 = to('end', integer($this, end));
    var tmp_1 = to('timestamp', integer($this, now));
    // Inline function 'kotlin.math.floor' call
    var tmp_2 = Math.floor(now);
    // Inline function 'kotlin.math.floor' call
    var tmp$ret$1 = Math.floor(start);
    return mapOf_0([tmp, tmp_0, tmp_1, to('offset', integer($this, tmp_2 - tmp$ret$1)), to('duration', integer($this, end - start))]);
  }
  function Resource(prefix, name, suffix) {
    this.prefix_1 = prefix;
    this.name_1 = name;
    this.suffix_1 = suffix;
  }
  protoOf(Resource).toString = function () {
    return 'Resource(prefix=' + this.prefix_1 + ', name=' + this.name_1 + ', suffix=' + this.suffix_1 + ')';
  };
  protoOf(Resource).hashCode = function () {
    var result = getStringHashCode(this.prefix_1);
    result = imul(result, 31) + getStringHashCode(this.name_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.suffix_1) | 0;
    return result;
  };
  protoOf(Resource).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof Resource))
      return false;
    if (!(this.prefix_1 === other.prefix_1))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    if (!(this.suffix_1 === other.suffix_1))
      return false;
    return true;
  };
  function resource($this, url, decoded, stripFragment) {
    var clean = substringBefore(url, _Char___init__impl__6a9atx(35));
    var path = substringBefore(clean, _Char___init__impl__6a9atx(63));
    var slash = lastIndexOf(path, _Char___init__impl__6a9atx(47));
    var scheme = indexOf_3(path, '://');
    if (slash < 0 || (scheme >= 0 && slash < (scheme + 3 | 0)))
      return null;
    var tmp = substring(path, 0, slash + 1 | 0);
    return new Resource(tmp, decoded == null ? substring_0(path, slash + 1 | 0) : decoded, substring_0(stripFragment ? clean : url, path.length));
  }
  function appendQuery($this, url, query, stripFragment) {
    stripFragment = stripFragment === VOID ? false : stripFragment;
    var base = stripFragment ? substringBefore(url, _Char___init__impl__6a9atx(35)) : url;
    return base + (contains_2(base, _Char___init__impl__6a9atx(63)) ? '&' : '?') + query;
  }
  function integer($this, value) {
    // Inline function 'kotlin.math.floor' call
    var tmp$ret$0 = Math.floor(value);
    return numberToLong(tmp$ret$0).toString();
  }
  function truncate($this, value) {
    var tmp;
    if (value < 0) {
      // Inline function 'kotlin.math.ceil' call
      tmp = Math.ceil(value);
    } else {
      // Inline function 'kotlin.math.floor' call
      tmp = Math.floor(value);
    }
    return tmp;
  }
  function number($this, value) {
    var tmp;
    // Inline function 'kotlin.math.floor' call
    if (value === Math.floor(value)) {
      tmp = integer($this, value);
    } else {
      tmp = value.toString();
    }
    return tmp;
  }
  function pad($this, value) {
    return padStart(value.toString(), 2, _Char___init__impl__6a9atx(48));
  }
  function component($this, value) {
    var index = 0;
    while (index < value.length) {
      var _unary__edvuaz = index;
      index = _unary__edvuaz + 1 | 0;
      var char = charCodeAt(value, _unary__edvuaz);
      if (_Char___init__impl__6a9atx(55296) <= char ? char <= _Char___init__impl__6a9atx(56319) : false) {
        var tmp0 = Char__rangeTo_impl_tkncvp(_Char___init__impl__6a9atx(56320), _Char___init__impl__6a9atx(57343));
        // Inline function 'kotlin.ranges.contains' call
        var element = getOrNull_1(value, index);
        var tmp;
        var tmp_0 = element;
        if (!((tmp_0 == null ? null : new Char(tmp_0)) == null)) {
          tmp = tmp0.contains_egozq6_k$(element);
        } else {
          tmp = false;
        }
        if (!tmp)
          return null;
        index = index + 1 | 0;
      } else if (_Char___init__impl__6a9atx(56320) <= char ? char <= _Char___init__impl__6a9atx(57343) : false)
        return null;
    }
    var hex = '0123456789ABCDEF';
    // Inline function 'kotlin.text.buildString' call
    // Inline function 'kotlin.apply' call
    var this_0 = StringBuilder_init_$Create$_0();
    var indexedObject = encodeToByteArray(value);
    var inductionVariable = 0;
    var last = indexedObject.length;
    while (inductionVariable < last) {
      var byte = indexedObject[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var code = byte & 255;
      var char_0 = numberToChar(code);
      if ((_Char___init__impl__6a9atx(97) <= char_0 ? char_0 <= _Char___init__impl__6a9atx(122) : false) || (_Char___init__impl__6a9atx(65) <= char_0 ? char_0 <= _Char___init__impl__6a9atx(90) : false) || (_Char___init__impl__6a9atx(48) <= char_0 ? char_0 <= _Char___init__impl__6a9atx(57) : false) || contains_2("-_.!~*'()", char_0))
        this_0.append_58al37_k$(char_0);
      else {
        this_0.append_58al37_k$(_Char___init__impl__6a9atx(37));
        this_0.append_58al37_k$(charCodeAt(hex, code / 16 | 0));
        this_0.append_58al37_k$(charCodeAt(hex, code % 16 | 0));
      }
    }
    return this_0.toString();
  }
  function rule($this, archive, absolute) {
    return to(archive, absolute);
  }
  function TemplateFormat_BROWSER_getInstance() {
    static_init_0();
    return TemplateFormat_BROWSER_instance;
  }
  function TemplateFormat_MODERN_getInstance() {
    static_init_0();
    return TemplateFormat_MODERN_instance;
  }
  function TemplateFormat_PROVIDER_getInstance() {
    static_init_0();
    return TemplateFormat_PROVIDER_instance;
  }
  function Archive() {
    Archive_instance = this;
    this.standardResources_1 = linkedMapOf([to('mpegts', rule(this, 'archive-${start}-${duration}.ts', 'timeshift_abs-${start}.ts')), to('video.m3u8', rule(this, 'video-${start}-${duration}.m3u8', 'video-timeshift_abs-${start}.m3u8')), to('mono.m3u8', rule(this, 'mono-${start}-${duration}.m3u8', 'mono-timeshift_abs-${start}.m3u8')), to('index.m3u8', rule(this, 'archive-${start}-${duration}.m3u8', 'timeshift_abs-${start}.m3u8')), to('index.mpd', rule(this, 'archive-${start}-${duration}.mpd', 'timeshift_abs-${start}.mpd'))]);
    this.kbResources_1 = linkedMapOf([to('mpegts', rule(this, '${start}-${duration}', 'timeshift_abs/${start}')), to('video.m3u8', rule(this, 'video-${start}-${duration}.m3u8', 'timeshift_abs_video-${start}.m3u8')), to('index.m3u8', rule(this, 'index-${start}-${duration}.m3u8', 'timeshift_abs-${start}.m3u8')), to('index.mpd', rule(this, 'archive-${start}-${duration}.mdp', 'timeshift_abs-${start}.mdp'))]);
    this.providerResources_1 = mapOf_0([to('only4', listOf_0([getValue(this.kbResources_1, 'mpegts'), getValue(this.kbResources_1, 'video.m3u8'), getValue(this.kbResources_1, 'index.m3u8')])), to('itv', listOf_0([getValue(this.kbResources_1, 'index.m3u8'), getValue(this.kbResources_1, 'mpegts'), getValue(this.kbResources_1, 'video.m3u8')])), to('antifriz', listOf_0([getValue(this.kbResources_1, 'index.m3u8'), getValue(this.kbResources_1, 'mpegts'), getValue(this.standardResources_1, 'video.m3u8'), getValue(this.standardResources_1, 'mono.m3u8'), rule(this, 'index-${start}-${duration}.mpd', 'timeshift_abs-${start}.mpd')]))]);
  }
  protoOf(Archive).resolve_obujz6_k$ = function (request, format, calendar, resolveUrl) {
    var r = request;
    var browser = format.equals(ArchiveFormat_BROWSER_getInstance());
    var tmp;
    var tmp_0;
    var tmp_1;
    var tmp0 = listOf_0([r.start_1, r.end_1, r.now_1, r.days_1, r.correction_1]);
    var tmp$ret$0;
    $l$block_0: {
      // Inline function 'kotlin.collections.all' call
      var tmp_2;
      if (isInterface(tmp0, Collection)) {
        tmp_2 = tmp0.isEmpty_y1axqb_k$();
      } else {
        tmp_2 = false;
      }
      if (tmp_2) {
        tmp$ret$0 = true;
        break $l$block_0;
      }
      var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        if (!isFinite(element)) {
          tmp$ret$0 = false;
          break $l$block_0;
        }
      }
      tmp$ret$0 = true;
    }
    if (!tmp$ret$0) {
      tmp_1 = true;
    } else {
      tmp_1 = !r.live_1;
    }
    if (tmp_1) {
      tmp_0 = true;
    } else {
      tmp_0 = r.start_1 >= r.now_1;
    }
    if (tmp_0) {
      tmp = true;
    } else {
      tmp = r.end_1 <= r.start_1;
    }
    if (tmp)
      return null;
    if (browser && (r.days_1 <= 0 || r.end_1 > r.now_1))
      return null;
    if (r.days_1 > 0 && r.now_1 - r.start_1 > r.days_1 * 86400)
      return null;
    var tmp_3;
    var tmp_4;
    var tmp_5;
    if (!browser) {
      // Inline function 'kotlin.text.isNotBlank' call
      var this_0 = r.epgId_1;
      tmp_5 = !isBlank(this_0);
    } else {
      tmp_5 = false;
    }
    if (tmp_5) {
      tmp_4 = !equals_0(r.channelId_1, r.epgId_1, true);
    } else {
      tmp_4 = false;
    }
    if (tmp_4) {
      tmp_3 = !equals_0(r.channelId_1, r.channelName_1, true);
    } else {
      tmp_3 = false;
    }
    if (tmp_3)
      return null;
    var tmp_6;
    if (browser) {
      tmp_6 = new Span(r.start_1, r.end_1, r.now_1);
    } else {
      var tmp_7 = truncate(this, r.start_1);
      var tmp0_0 = r.end_1;
      // Inline function 'kotlin.comparisons.minOf' call
      var b = r.now_1;
      var tmp$ret$3 = Math.min(tmp0_0, b);
      tmp_6 = new Span(tmp_7, truncate(this, tmp$ret$3), truncate(this, r.now_1));
    }
    var span = tmp_6;
    if (span.end_1 <= span.start_1)
      return null;
    var tmp_8;
    if (browser) {
      tmp_8 = r.mode_1;
    } else {
      // Inline function 'kotlin.text.lowercase' call
      // Inline function 'kotlin.js.asDynamic' call
      tmp_8 = r.mode_1.toLowerCase();
    }
    var mode = tmp_8;
    if (mode === 'none')
      return null;
    if (browser && mode === 'xtream') {
      var tmp_9;
      var tmp_10;
      var tmp_11;
      var tmp_12;
      var tmp_13;
      // Inline function 'kotlin.text.isEmpty' call
      var this_1 = r.base_1;
      if (charSequenceLength(this_1) === 0) {
        tmp_13 = true;
      } else {
        tmp_13 = r.username_1 == null;
      }
      if (tmp_13) {
        tmp_12 = true;
      } else {
        tmp_12 = r.password_1 == null;
      }
      if (tmp_12) {
        tmp_11 = true;
      } else {
        // Inline function 'kotlin.text.isEmpty' call
        var this_2 = r.streamId_1;
        tmp_11 = charSequenceLength(this_2) === 0;
      }
      if (tmp_11) {
        tmp_10 = true;
      } else {
        var tmp0_1 = r.streamId_1;
        var tmp$ret$8;
        $l$block_1: {
          // Inline function 'kotlin.text.any' call
          var inductionVariable = 0;
          while (inductionVariable < charSequenceLength(tmp0_1)) {
            var element_0 = charSequenceGet(tmp0_1, inductionVariable);
            inductionVariable = inductionVariable + 1 | 0;
            if (!(_Char___init__impl__6a9atx(48) <= element_0 ? element_0 <= _Char___init__impl__6a9atx(57) : false)) {
              tmp$ret$8 = true;
              break $l$block_1;
            }
          }
          tmp$ret$8 = false;
        }
        tmp_10 = tmp$ret$8;
      }
      if (tmp_10) {
        tmp_9 = true;
      } else {
        tmp_9 = !listOf_0(['ts', 'm3u8']).contains_aljjnj_k$(r.extension_1);
      }
      if (tmp_9)
        return null;
      // Inline function 'kotlin.math.floor' call
      var x = (span.start_1 + r.correction_1 * 3600) / 60;
      var start = Math.floor(x) * 60;
      // Inline function 'kotlin.math.ceil' call
      var x_0 = (span.end_1 + r.correction_1 * 3600 - start) / 60;
      // Inline function 'kotlin.comparisons.maxOf' call
      var b_0 = Math.ceil(x_0);
      var minutes = Math.max(1.0, b_0);
      var tmp0_elvis_lhs = span.values$default_ntia98_k$(calendar, start).get_wei43m_k$('startDate');
      var tmp_14;
      if (tmp0_elvis_lhs == null) {
        return null;
      } else {
        tmp_14 = tmp0_elvis_lhs;
      }
      var date = tmp_14;
      var tmp1_elvis_lhs = component(this, r.username_1);
      var tmp_15;
      if (tmp1_elvis_lhs == null) {
        return null;
      } else {
        tmp_15 = tmp1_elvis_lhs;
      }
      var user = tmp_15;
      var tmp2_elvis_lhs = component(this, r.password_1);
      var tmp_16;
      if (tmp2_elvis_lhs == null) {
        return null;
      } else {
        tmp_16 = tmp2_elvis_lhs;
      }
      var password = tmp_16;
      return resolveUrl(trimEnd(r.base_1, charArrayOf([_Char___init__impl__6a9atx(47)])) + ('/timeshift/' + user + '/' + password + '/' + integer(this, minutes) + '/' + date + '/' + r.streamId_1 + '.' + r.extension_1));
    }
    var tmp_17;
    if (browser) {
      var tmp_18 = CoreText_getInstance();
      tmp_17 = tmp_18.trim_l1e112_k$(r.source_1, CoreText$space$ref(CoreText_getInstance()));
    } else {
      tmp_17 = r.source_1;
    }
    var explicit = tmp_17;
    var flussonic = browser ? mode === 'flussonic' : isBlank(explicit) && startsWith(mode, 'flussonic');
    if (flussonic) {
      var tmp_19;
      if (browser) {
        var tmp_20;
        // Inline function 'kotlin.math.abs' call
        var x_1 = r.correction_1;
        if (Math.abs(x_1) > 24) {
          tmp_20 = true;
        } else {
          tmp_20 = r.days_1 > 30;
        }
        tmp_19 = tmp_20;
      } else {
        tmp_19 = false;
      }
      if (tmp_19)
        return null;
      // Inline function 'kotlin.math.floor' call
      var x_2 = span.start_1 + r.correction_1 * 3600;
      var start_0 = Math.floor(x_2);
      if (browser && (start_0 < 0 || span.get_duration_6a6kpp_k$() < 1))
        return null;
      var tmp3_elvis_lhs = resource(this, r.url_1, r.resourceName_1, browser);
      var tmp_21;
      if (tmp3_elvis_lhs == null) {
        return null;
      } else {
        tmp_21 = tmp3_elvis_lhs;
      }
      var parts = tmp_21;
      var tmp4_elvis_lhs = this.standardResources_1.get_wei43m_k$(parts.name_1);
      var tmp_22;
      if (tmp4_elvis_lhs == null) {
        return null;
      } else {
        tmp_22 = tmp4_elvis_lhs;
      }
      var rule = tmp_22;
      var template = !browser && span.start_1 > span.now_1 - 600 ? rule.second_1 : rule.first_1;
      var tmp5_elvis_lhs = expand(this, template, span.values$default_ntia98_k$(calendar, start_0), TemplateFormat_MODERN_getInstance());
      var tmp_23;
      if (tmp5_elvis_lhs == null) {
        return null;
      } else {
        tmp_23 = tmp5_elvis_lhs;
      }
      var value = tmp_23;
      return resolveUrl(parts.prefix_1 + value + parts.suffix_1);
    }
    var tmp_24;
    var tmp_25;
    if (!browser) {
      // Inline function 'kotlin.text.isNotBlank' call
      tmp_25 = !isBlank(explicit);
    } else {
      tmp_25 = false;
    }
    if (tmp_25) {
      tmp_24 = mode === 'append' ? r.url_1 + explicit : explicit;
    } else {
      if (browser && !listOf_0(['default', 'append', 'vod', 'shift']).contains_aljjnj_k$(mode)) {
        return null;
      } else {
        if (mode === 'shift' || (!browser && listOf_0(['default', 'shift', 'append']).contains_aljjnj_k$(mode))) {
          tmp_24 = '?utc={utc}&lutc={lutc}';
        } else {
          tmp_24 = explicit;
        }
      }
    }
    var raw = tmp_24;
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(raw) === 0)
      return null;
    // Inline function 'kotlin.math.floor' call
    var x_3 = span.start_1 + r.correction_1 * 3600;
    var corrected = Math.floor(x_3);
    // Inline function 'kotlin.math.floor' call
    var x_4 = span.end_1 + r.correction_1 * 3600;
    var tmp$ret$18 = Math.floor(x_4);
    var values = span.values_80k4nh_k$(calendar, corrected, tmp$ret$18);
    var tmp6_elvis_lhs = expand(this, raw, values, browser ? TemplateFormat_BROWSER_getInstance() : TemplateFormat_MODERN_getInstance(), r.programmeId_1);
    var tmp_26;
    if (tmp6_elvis_lhs == null) {
      return null;
    } else {
      tmp_26 = tmp6_elvis_lhs;
    }
    var expanded = tmp_26;
    var tmp_27;
    if (browser && listOf_0(['append', 'shift']).contains_aljjnj_k$(mode) || (!browser && isBlank(explicit))) {
      var tmp_28;
      // Inline function 'kotlin.text.isEmpty' call
      var this_3 = r.url_1;
      if (charSequenceLength(this_3) === 0) {
        tmp_28 = true;
      } else {
        var tmp_29 = listOf_0([new Char(_Char___init__impl__6a9atx(63)), new Char(_Char___init__impl__6a9atx(38))]);
        var tmp_30 = firstOrNull_0(expanded);
        tmp_28 = !contains_0(tmp_29, tmp_30 == null ? null : new Char(tmp_30));
      }
      if (tmp_28)
        return null;
      tmp_27 = appendQuery(this, r.url_1, drop_0(expanded, 1), browser);
    } else {
      tmp_27 = expanded;
    }
    var appended = tmp_27;
    return resolveUrl(appended);
  };
  protoOf(Archive).provider_rls0fs_k$ = function (profile, url, source, mode, start, end, now, dune, variant) {
    var tmp0 = listOf_0([start, end, now]);
    var tmp$ret$0;
    $l$block_0: {
      // Inline function 'kotlin.collections.all' call
      var tmp;
      if (isInterface(tmp0, Collection)) {
        tmp = tmp0.isEmpty_y1axqb_k$();
      } else {
        tmp = false;
      }
      if (tmp) {
        tmp$ret$0 = true;
        break $l$block_0;
      }
      var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        if (!isFinite(element)) {
          tmp$ret$0 = false;
          break $l$block_0;
        }
      }
      tmp$ret$0 = true;
    }
    if (!tmp$ret$0)
      return null;
    var query;
    switch (profile) {
      case 'utc':
        query = 'utc=' + integer(this, start);
        break;
      case 'archive':
        query = 'archive=' + integer(this, start);
        break;
      case 'utc-now':
      case 'auto-utc-now':
        query = 'utc=' + integer(this, start) + '&lutc=' + integer(this, now);
        break;
      case 'club':
        query = end < now && !dune ? 'archive=' + number(this, start) + '&archive_end=' + number(this, end) : 'timeshift=' + number(this, start) + '&timenow=' + number(this, now);
        break;
      default:
        query = null;
        break;
    }
    if (!(query == null))
      return profile === 'auto-utc-now' ? appendQuery(this, url, query) : url + '?' + query;
    var paddedFallback = listOf_0(['only4', 'itv', 'antifriz']).contains_aljjnj_k$(profile);
    var stop = end < start ? now + (paddedFallback ? 600 : 0) : end;
    if (profile === 'template') {
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(source) === 0)
        return null;
      return expand(this, source, legacyValues(this, start, stop, now), TemplateFormat_PROVIDER_getInstance());
    }
    if (!listOf_0(['m3u', 'kb', 'only4', 'itv', 'antifriz']).contains_aljjnj_k$(profile))
      return null;
    if (dune && !paddedFallback)
      stop = stop + 7200;
    var span = new Span(start, stop, now);
    var resourceTable = profile === 'kb' ? this.kbResources_1 : this.standardResources_1;
    var tmp_0;
    if (listOf_0(['m3u', 'kb']).contains_aljjnj_k$(profile) && contains_1(mode, 'flussonic')) {
      var tmp0_0 = resourceTable.get_keys_wop4xp_k$();
      var tmp$ret$3;
      $l$block_1: {
        // Inline function 'kotlin.collections.firstOrNull' call
        var _iterator__ex2g4s_0 = tmp0_0.iterator_jk1svi_k$();
        while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
          var element_0 = _iterator__ex2g4s_0.next_20eer_k$();
          if (contains_1(url, element_0)) {
            tmp$ret$3 = element_0;
            break $l$block_1;
          }
        }
        tmp$ret$3 = null;
      }
      tmp_0 = tmp$ret$3;
    } else {
      tmp_0 = null;
    }
    var detected = tmp_0;
    if (!(detected == null) || paddedFallback) {
      var tmp_1;
      if (!(detected == null)) {
        tmp_1 = getValue(resourceTable, detected);
      } else {
        var tmp1_safe_receiver = this.providerResources_1.get_wei43m_k$(profile);
        var tmp2_elvis_lhs = tmp1_safe_receiver == null ? null : getOrNull_0(tmp1_safe_receiver, variant);
        var tmp_2;
        if (tmp2_elvis_lhs == null) {
          return null;
        } else {
          tmp_2 = tmp2_elvis_lhs;
        }
        tmp_1 = tmp_2;
      }
      var rule = tmp_1;
      var absolute = start > now - 600 || (profile === 'kb' && detected === 'mpegts') || (profile === 'only4' && variant === 0) || (listOf_0(['itv', 'antifriz']).contains_aljjnj_k$(profile) && variant === 1);
      if (!absolute && dune && paddedFallback) {
        // Inline function 'kotlin.math.floor' call
        var x = stop;
        stop = Math.floor(x) + 7200;
      }
      var tmp3_elvis_lhs = expand(this, absolute ? rule.second_1 : rule.first_1, legacyValues(this, start, stop, now), TemplateFormat_PROVIDER_getInstance());
      var tmp_3;
      if (tmp3_elvis_lhs == null) {
        return null;
      } else {
        tmp_3 = tmp3_elvis_lhs;
      }
      var value = tmp_3;
      var marker = detected == null ? profile === 'only4' ? 'index.m3u8' : '' : detected;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(marker) === 0)
        return url + value + source;
      var parts = split(url, [marker]);
      var tmp_4 = parts.get_c1px32_k$(0) + value;
      var tmp5_elvis_lhs = getOrNull_0(parts, 1);
      return tmp_4 + (tmp5_elvis_lhs == null ? 'undefined' : tmp5_elvis_lhs);
    }
    // Inline function 'kotlin.text.isNotEmpty' call
    if (charSequenceLength(source) > 0)
      return expand(this, mode === 'append' ? url + source : source, legacyValues(this, span.start_1, span.end_1, span.now_1), TemplateFormat_PROVIDER_getInstance());
    return appendQuery(this, url, 'utc=' + integer(this, start) + '&lutc=' + integer(this, now));
  };
  var Archive_instance;
  function Archive_getInstance() {
    if (Archive_instance == null)
      new Archive();
    return Archive_instance;
  }
  function ArchiveFormat_BROWSER_getInstance() {
    static_init();
    return ArchiveFormat_BROWSER_instance;
  }
  function CoreText$space$ref(p0) {
    return constructCallableReference(function (p0_0) {
      return p0.space_3ylfpz_k$(p0_0.value_1);
    }, 1, 0, 0, 'space', [p0]);
  }
  function CoreText() {
    CoreText_instance = this;
    var tmp = this;
    // Inline function 'kotlin.intArrayOf' call
    tmp.decimalZeros_1 = new Int32Array([48, 1632, 1776, 1984, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302, 3430, 3558, 3664, 3792, 3872, 4160, 4240, 6112, 6160, 6470, 6608, 6784, 6800, 6992, 7088, 7232, 7248, 42528, 43216, 43264, 43472, 43504, 43600, 44016, 65296, 66720, 68912, 68928, 69734, 69872, 69942, 70096, 70384, 70736, 70864, 71248, 71360, 71376, 71386, 71472, 71904, 72016, 72688, 72784, 73040, 73120, 73552, 90416, 92768, 92864, 93008, 93552, 118000, 120782, 120792, 120802, 120812, 120822, 123200, 123632, 124144, 124401, 125264, 130032]);
  }
  protoOf(CoreText).replaceLiteralFirst_r86yx1_k$ = function (value, search, replacement) {
    var index = indexOf_3(value, search);
    return index < 0 ? value : substring(value, 0, index) + replacement + substring_0(value, index + search.length | 0);
  };
  protoOf(CoreText).digitAt_gwvjdq_k$ = function (value, index) {
    // Inline function 'kotlin.code' call
    var this_0 = charCodeAt(value, index);
    var first = Char__toInt_impl_vasixd(this_0);
    var tmp;
    var tmp_0;
    if ((55296 <= first ? first <= 56319 : false) && (index + 1 | 0) < value.length) {
      // Inline function 'kotlin.code' call
      var this_1 = charCodeAt(value, index + 1 | 0);
      var containsArg = Char__toInt_impl_vasixd(this_1);
      tmp_0 = 56320 <= containsArg ? containsArg <= 57343 : false;
    } else {
      tmp_0 = false;
    }
    if (tmp_0) {
      tmp = 2;
    } else {
      tmp = 1;
    }
    var width = tmp;
    var tmp_1;
    if (width === 2) {
      var tmp_2 = 65536 + imul(first - 55296 | 0, 1024) | 0;
      // Inline function 'kotlin.code' call
      var this_2 = charCodeAt(value, index + 1 | 0);
      tmp_1 = (tmp_2 + Char__toInt_impl_vasixd(this_2) | 0) - 56320 | 0;
    } else {
      tmp_1 = first;
    }
    var scalar = tmp_1;
    var indexedObject = this.decimalZeros_1;
    var inductionVariable = 0;
    var last = indexedObject.length;
    while (inductionVariable < last) {
      var zero = indexedObject[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      if (scalar < zero)
        return null;
      if (scalar < (zero + 10 | 0))
        return new Pair(scalar - zero | 0, width);
    }
    return null;
  };
  protoOf(CoreText).space_3ylfpz_k$ = function (value) {
    return (_Char___init__impl__6a9atx(9) <= value ? value <= _Char___init__impl__6a9atx(13) : false) || (_Char___init__impl__6a9atx(8192) <= value ? value <= _Char___init__impl__6a9atx(8202) : false) || value === _Char___init__impl__6a9atx(32) || value === _Char___init__impl__6a9atx(160) || value === _Char___init__impl__6a9atx(5760) || value === _Char___init__impl__6a9atx(8232) || value === _Char___init__impl__6a9atx(8233) || value === _Char___init__impl__6a9atx(8239) || value === _Char___init__impl__6a9atx(8287) || value === _Char___init__impl__6a9atx(12288) || value === _Char___init__impl__6a9atx(65279);
  };
  protoOf(CoreText).androidSpace_lowt9i_k$ = function (value) {
    return this.space_3ylfpz_k$(value) && !(value === _Char___init__impl__6a9atx(65279)) || (_Char___init__impl__6a9atx(28) <= value ? value <= _Char___init__impl__6a9atx(31) : false);
  };
  protoOf(CoreText).unicodeSpace_yjjgmk_k$ = function (value) {
    return this.space_3ylfpz_k$(value) && !(value === _Char___init__impl__6a9atx(65279)) || value === _Char___init__impl__6a9atx(133);
  };
  protoOf(CoreText).asciiSpace_pupxmg_k$ = function (value) {
    return value === _Char___init__impl__6a9atx(32) || (_Char___init__impl__6a9atx(9) <= value ? value <= _Char___init__impl__6a9atx(13) : false);
  };
  protoOf(CoreText).trim_l1e112_k$ = function (value, whitespace) {
    var start = 0;
    var end = value.length;
    while (start < end && whitespace(new Char(charCodeAt(value, start)))) {
      start = start + 1 | 0;
    }
    while (end > start && whitespace(new Char(charCodeAt(value, end - 1 | 0)))) {
      end = end - 1 | 0;
    }
    return substring(value, start, end);
  };
  protoOf(CoreText).trim$default_yjecrm_k$ = function (value, whitespace, $super) {
    var tmp;
    if (whitespace === VOID) {
      tmp = CoreText$space$ref(this);
    } else {
      tmp = whitespace;
    }
    whitespace = tmp;
    return $super === VOID ? this.trim_l1e112_k$(value, whitespace) : $super.trim_l1e112_k$.call(this, value, whitespace);
  };
  protoOf(CoreText).normalizedSpaces_bcspd8_k$ = function (value, whitespace) {
    var result = StringBuilder_init_$Create$_0();
    var pendingSpace = false;
    var inductionVariable = 0;
    var last = value.length;
    while (inductionVariable < last) {
      var character = charCodeAt(value, inductionVariable);
      inductionVariable = inductionVariable + 1 | 0;
      if (whitespace(new Char(character))) {
        // Inline function 'kotlin.text.isNotEmpty' call
        pendingSpace = charSequenceLength(result) > 0;
      } else {
        if (pendingSpace) {
          result.append_58al37_k$(_Char___init__impl__6a9atx(32));
        }
        result.append_58al37_k$(character);
        pendingSpace = false;
      }
    }
    return result.toString();
  };
  protoOf(CoreText).normalizedSpaces$default_3rlqo4_k$ = function (value, whitespace, $super) {
    var tmp;
    if (whitespace === VOID) {
      tmp = CoreText$space$ref(this);
    } else {
      tmp = whitespace;
    }
    whitespace = tmp;
    return $super === VOID ? this.normalizedSpaces_bcspd8_k$(value, whitespace) : $super.normalizedSpaces_bcspd8_k$.call(this, value, whitespace);
  };
  var CoreText_instance;
  function CoreText_getInstance() {
    if (CoreText_instance == null)
      new CoreText();
    return CoreText_instance;
  }
  function CoreText$unicodeSpace$ref(p0) {
    return constructCallableReference(function (p0_0) {
      return p0.unicodeSpace_yjjgmk_k$(p0_0.value_1);
    }, 1, 0, 1, 'unicodeSpace', [p0]);
  }
  function CoreText$androidSpace$ref(p0) {
    return constructCallableReference(function (p0_0) {
      return p0.androidSpace_lowt9i_k$(p0_0.value_1);
    }, 1, 0, 2, 'androidSpace', [p0]);
  }
  function CoreText$asciiSpace$ref(p0) {
    return constructCallableReference(function (p0_0) {
      return p0.asciiSpace_pupxmg_k$(p0_0.value_1);
    }, 1, 0, 3, 'asciiSpace', [p0]);
  }
  function bounded($this, value, fallback, maximum) {
    // Inline function 'kotlin.math.floor' call
    var x = isNaN_0(value) || value === 0.0 ? fallback : value;
    var tmp$ret$0 = Math.floor(x);
    return numberToInt(coerceIn(tmp$ret$0, 1.0, maximum));
  }
  function Slot(value, weight) {
    this.value_1 = value;
    this.weight_1 = weight;
  }
  protoOf(Slot).toString = function () {
    return 'Slot(value=' + toString_0(this.value_1) + ', weight=' + this.weight_1 + ')';
  };
  protoOf(Slot).hashCode = function () {
    var result = this.value_1 == null ? 0 : hashCode_0(this.value_1);
    result = imul(result, 31) + this.weight_1 | 0;
    return result;
  };
  protoOf(Slot).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof Slot))
      return false;
    if (!equals(this.value_1, other.value_1))
      return false;
    if (!(this.weight_1 === other.weight_1))
      return false;
    return true;
  };
  function Companion_11() {
  }
  var Companion_instance_11;
  function Companion_getInstance_11() {
    return Companion_instance_11;
  }
  function GuideLookupCache(limit, entryLimit) {
    var tmp = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    tmp.slots_1 = LinkedHashMap_init_$Create$();
    var tmp_0 = this;
    // Inline function 'kotlin.collections.mutableListOf' call
    tmp_0.order_1 = ArrayList_init_$Create$();
    this.capacity_1 = bounded(Companion_instance_11, limit, 1024, 8192);
    this.weightLimit_1 = bounded(Companion_instance_11, entryLimit, 65536, 65536);
    this.protected_1 = imul(this.capacity_1, 3) / 4 | 0;
    this.cursor_1 = 0;
    this.weight_1 = 0;
  }
  protoOf(GuideLookupCache).clear_j9egeb_k$ = function () {
    this.slots_1.clear_j9egeb_k$();
    this.order_1.clear_j9egeb_k$();
    this.cursor_1 = 0;
    this.weight_1 = 0;
  };
  protoOf(GuideLookupCache).get_wei43m_k$ = function (key) {
    var tmp0_safe_receiver = this.slots_1.get_wei43m_k$(key);
    return tmp0_safe_receiver == null ? null : tmp0_safe_receiver.value_1;
  };
  protoOf(GuideLookupCache).put_y44h9a_k$ = function (key, value, cost) {
    var tmp;
    if (this.order_1.get_size_woubt6_k$() === this.capacity_1) {
      var tmp0 = this.cursor_1;
      // Inline function 'kotlin.comparisons.maxOf' call
      var b = this.protected_1;
      var tmp$ret$0 = Math.max(tmp0, b);
      tmp = this.order_1.get_c1px32_k$(tmp$ret$0);
    } else {
      tmp = null;
    }
    var victim = tmp;
    var tmp_0 = this.weight_1 + cost | 0;
    // Inline function 'kotlin.collections.get' call
    var this_0 = this.slots_1;
    var tmp0_safe_receiver = (isInterface(this_0, KtMap) ? this_0 : THROW_CCE()).get_wei43m_k$(victim);
    var tmp1_elvis_lhs = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.weight_1;
    var retained = tmp_0 - (tmp1_elvis_lhs == null ? 0 : tmp1_elvis_lhs) | 0;
    if (retained > this.weightLimit_1)
      return Unit_instance;
    if (this.order_1.get_size_woubt6_k$() < this.capacity_1)
      this.order_1.add_utx5q5_k$(key);
    else {
      var tmp_1 = this;
      var tmp0_0 = this.cursor_1;
      // Inline function 'kotlin.comparisons.maxOf' call
      var b_0 = this.protected_1;
      tmp_1.cursor_1 = Math.max(tmp0_0, b_0);
      // Inline function 'kotlin.collections.remove' call
      var this_1 = this.slots_1;
      (isInterface(this_1, KtMutableMap) ? this_1 : THROW_CCE()).remove_gppy8k_k$(victim);
      this.order_1.set_82063s_k$(this.cursor_1, key);
      this.cursor_1 = (this.cursor_1 + 1 | 0) < this.capacity_1 ? this.cursor_1 + 1 | 0 : this.protected_1;
    }
    this.weight_1 = retained;
    var tmp0_1 = this.slots_1;
    // Inline function 'kotlin.collections.set' call
    var value_0 = new Slot(value, cost);
    tmp0_1.put_4fpzoq_k$(key, value_0);
  };
  function GuideResponseCache() {
  }
  protoOf(GuideResponseCache).capacity_u8oxzg_k$ = function (value) {
    var tmp;
    if (isFinite(value) && value > 0) {
      // Inline function 'kotlin.math.floor' call
      tmp = Math.floor(value);
    } else {
      tmp = 0.0;
    }
    return tmp;
  };
  protoOf(GuideResponseCache).read_dhesoo_k$ = function (capacity, count, fetched, end, clock) {
    if (capacity <= 0 || count === 0 || fetched == null)
      return 0;
    if (clock() - fetched >= 43200000)
      return -1;
    var tmp;
    var tmp0 = until(0, count);
    var tmp$ret$0;
    $l$block_0: {
      // Inline function 'kotlin.collections.any' call
      var tmp_0;
      if (isInterface(tmp0, Collection)) {
        tmp_0 = tmp0.isEmpty_y1axqb_k$();
      } else {
        tmp_0 = false;
      }
      if (tmp_0) {
        tmp$ret$0 = false;
        break $l$block_0;
      }
      var inductionVariable = tmp0.first_1;
      var last = tmp0.last_1;
      if (inductionVariable <= last)
        do {
          var element = inductionVariable;
          inductionVariable = inductionVariable + 1 | 0;
          if (end(element) >= clock() / 1000) {
            tmp$ret$0 = true;
            break $l$block_0;
          }
        }
         while (!(element === last));
      tmp$ret$0 = false;
    }
    if (tmp$ret$0) {
      tmp = 1;
    } else {
      tmp = -1;
    }
    return tmp;
  };
  protoOf(GuideResponseCache).touch_xfw5md_k$ = function (order, id, limit, remove) {
    var next = toMutableList(order);
    next.remove_cedx0m_k$(id);
    if (!remove) {
      next.add_dl6gt3_k$(0, id);
    }
    var tmp1_safe_receiver = limit == null ? null : coerceAtMost_0(limit, next.get_size_woubt6_k$());
    var tmp2_elvis_lhs = tmp1_safe_receiver == null ? null : numberToInt(tmp1_safe_receiver);
    var size = tmp2_elvis_lhs == null ? next.get_size_woubt6_k$() : tmp2_elvis_lhs;
    return to(take(next, size), drop(next, size));
  };
  var GuideResponseCache_instance;
  function GuideResponseCache_getInstance() {
    return GuideResponseCache_instance;
  }
  function LegacyGuideSelection(current, following, retryAt) {
    this.current_1 = current;
    this.following_1 = following;
    this.retryAt_1 = retryAt;
  }
  protoOf(LegacyGuideSelection).toString = function () {
    return 'LegacyGuideSelection(current=' + this.current_1 + ', following=' + toString_1(this.following_1) + ', retryAt=' + this.retryAt_1 + ')';
  };
  protoOf(LegacyGuideSelection).hashCode = function () {
    var result = this.current_1;
    result = imul(result, 31) + hashCode_0(this.following_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.retryAt_1) | 0;
    return result;
  };
  protoOf(LegacyGuideSelection).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof LegacyGuideSelection))
      return false;
    if (!(this.current_1 === other.current_1))
      return false;
    if (!equals(this.following_1, other.following_1))
      return false;
    if (!equals(this.retryAt_1, other.retryAt_1))
      return false;
    return true;
  };
  function sam$kotlin_Comparator$0_0(function_0) {
    this.function_1 = function_0;
  }
  protoOf(sam$kotlin_Comparator$0_0).compare_bczr_k$ = function (a, b) {
    return this.function_1(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_0).compare = function (a, b) {
    return this.compare_bczr_k$(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_0).getFunctionDelegate_jtodtf_k$ = function () {
    return this.function_1;
  };
  protoOf(sam$kotlin_Comparator$0_0).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, Comparator) : false) {
      var tmp_0;
      if (!(other == null) ? isInterface(other, FunctionAdapter) : false) {
        tmp_0 = equals(this.getFunctionDelegate_jtodtf_k$(), other.getFunctionDelegate_jtodtf_k$());
      } else {
        tmp_0 = false;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(sam$kotlin_Comparator$0_0).hashCode = function () {
    return hashCode_0(this.getFunctionDelegate_jtodtf_k$());
  };
  function LegacyGuideSchedule$select$lambda($start) {
    return function (left, right) {
      var delta = $start(left) - $start(right);
      return delta < 0 ? -1 : delta > 0 ? 1 : 0;
    };
  }
  function LegacyGuideSchedule() {
  }
  protoOf(LegacyGuideSchedule).select_q0a6x2_k$ = function (count, start, end, now, nextCount) {
    var tmp = until(0, count);
    var tmp_0 = LegacyGuideSchedule$select$lambda(start);
    var ordered = sortedWith(tmp, new sam$kotlin_Comparator$0_0(tmp_0));
    var tmp$ret$0;
    $l$block: {
      // Inline function 'kotlin.collections.indexOfFirst' call
      var index = 0;
      var _iterator__ex2g4s = ordered.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var item = _iterator__ex2g4s.next_20eer_k$();
        if (end(item) >= now && start(item) <= now) {
          tmp$ret$0 = index;
          break $l$block;
        }
        index = index + 1 | 0;
      }
      tmp$ret$0 = -1;
    }
    var position = tmp$ret$0;
    if (position < 0)
      return new LegacyGuideSelection(-1, emptyList(), now + 3600);
    var requested = (position + 2 | 0) + nextCount;
    var tmp_1;
    if (isNaN_0(requested)) {
      tmp_1 = 0.0;
    } else if (requested < 0) {
      // Inline function 'kotlin.math.ceil' call
      tmp_1 = Math.ceil(requested);
    } else {
      // Inline function 'kotlin.math.floor' call
      tmp_1 = Math.floor(requested);
    }
    var integer = tmp_1;
    var until_0 = numberToInt(coerceIn(integer < 0 ? count + integer : integer, 0.0, count));
    return new LegacyGuideSelection(ordered.get_c1px32_k$(position), until_0 <= (position + 1 | 0) ? emptyList() : ordered.subList_xle3r2_k$(position + 1 | 0, until_0), 0.0);
  };
  var LegacyGuideSchedule_instance;
  function LegacyGuideSchedule_getInstance() {
    return LegacyGuideSchedule_instance;
  }
  function GuideProgrammeRules() {
  }
  protoOf(GuideProgrammeRules).browserShift_mvpua4_k$ = function (hours) {
    var tmp;
    var tmp_0;
    if (isFinite(hours)) {
      // Inline function 'kotlin.math.abs' call
      tmp_0 = Math.abs(hours) <= 24;
    } else {
      tmp_0 = false;
    }
    if (tmp_0) {
      tmp = hours * 3600;
    } else {
      tmp = 0.0;
    }
    return tmp;
  };
  protoOf(GuideProgrammeRules).legacyShift_98wu3x_k$ = function (shift, start, end) {
    return !(shift === 0.0) && !isNaN_0(shift) && start > 0 && end > 0;
  };
  protoOf(GuideProgrammeRules).validAndroid_h230qr_k$ = function (channel, start, end) {
    var tmp;
    var tmp_0;
    var tmp_1;
    // Inline function 'kotlin.text.isNotBlank' call
    if (!isBlank(channel)) {
      tmp_1 = !(start == null);
    } else {
      tmp_1 = false;
    }
    if (tmp_1) {
      tmp_0 = !(end == null);
    } else {
      tmp_0 = false;
    }
    if (tmp_0) {
      tmp = compare(end, start) > 0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  var GuideProgrammeRules_instance;
  function GuideProgrammeRules_getInstance() {
    return GuideProgrammeRules_instance;
  }
  function fromValue$number($value, key) {
    // Inline function 'kotlin.takeIf' call
    var this_0 = $value.get_6bo4tg_k$(key);
    var tmp;
    if (this_0.kind_1.equals(ProviderValueKind_NUMBER_getInstance())) {
      tmp = this_0;
    } else {
      tmp = null;
    }
    var tmp0_safe_receiver = tmp;
    var tmp1_safe_receiver = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.number_h3u0fr_k$();
    var tmp_0;
    if (tmp1_safe_receiver == null) {
      tmp_0 = null;
    } else {
      // Inline function 'kotlin.takeIf' call
      var tmp_1;
      if (isFinite(tmp1_safe_receiver)) {
        tmp_1 = tmp1_safe_receiver;
      } else {
        tmp_1 = null;
      }
      tmp_0 = tmp_1;
    }
    return tmp_0;
  }
  function fromValue$positive($value, key) {
    var tmp0_safe_receiver = fromValue$number($value, key);
    var tmp;
    if (tmp0_safe_receiver == null) {
      tmp = null;
    } else {
      // Inline function 'kotlin.takeIf' call
      var tmp_0;
      var tmp_1;
      if (1.0 <= tmp0_safe_receiver ? tmp0_safe_receiver <= 50000.0 : false) {
        // Inline function 'kotlin.math.floor' call
        tmp_1 = Math.floor(tmp0_safe_receiver) === tmp0_safe_receiver;
      } else {
        tmp_1 = false;
      }
      if (tmp_1) {
        tmp_0 = tmp0_safe_receiver;
      } else {
        tmp_0 = null;
      }
      tmp = tmp_0;
    }
    var tmp1_safe_receiver = tmp;
    return tmp1_safe_receiver == null ? null : numberToInt(tmp1_safe_receiver);
  }
  function parse$number($fields, key, positive) {
    positive = positive === VOID ? false : positive;
    var tmp = CoreText_getInstance();
    // Inline function 'kotlin.text.orEmpty' call
    var tmp0_elvis_lhs = $fields.get_wei43m_k$(key);
    var tmp$ret$0 = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
    var text = tmp.trim$default_yjecrm_k$(tmp$ret$0);
    var digits = startsWith_0(text, _Char___init__impl__6a9atx(45)) ? drop_0(text, 1) : text;
    var tmp_0;
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(digits) === 0) {
      tmp_0 = true;
    } else {
      var tmp$ret$2;
      $l$block: {
        // Inline function 'kotlin.text.any' call
        var inductionVariable = 0;
        while (inductionVariable < charSequenceLength(digits)) {
          var element = charSequenceGet(digits, inductionVariable);
          inductionVariable = inductionVariable + 1 | 0;
          if (!(_Char___init__impl__6a9atx(48) <= element ? element <= _Char___init__impl__6a9atx(57) : false)) {
            tmp$ret$2 = true;
            break $l$block;
          }
        }
        tmp$ret$2 = false;
      }
      tmp_0 = tmp$ret$2;
    }
    if (tmp_0)
      return null;
    var tmp0_elvis_lhs_0 = toDoubleOrNull(text);
    var tmp_1;
    if (tmp0_elvis_lhs_0 == null) {
      return null;
    } else {
      tmp_1 = tmp0_elvis_lhs_0;
    }
    var value = tmp_1;
    // Inline function 'kotlin.takeIf' call
    var tmp_2;
    var tmp_3;
    var tmp_4;
    if (isFinite(value)) {
      // Inline function 'kotlin.math.abs' call
      tmp_4 = Math.abs(value) <= toNumber(new Long(-1474199552, 2011));
    } else {
      tmp_4 = false;
    }
    if (tmp_4) {
      tmp_3 = !positive || (1.0 <= value ? value <= 50000.0 : false);
    } else {
      tmp_3 = false;
    }
    if (tmp_3) {
      tmp_2 = value;
    } else {
      tmp_2 = null;
    }
    return tmp_2;
  }
  function Companion_12() {
  }
  protoOf(Companion_12).fromValue_cdaik0_k$ = function (value) {
    var start = fromValue$number(value, 'windowStart');
    var end = fromValue$number(value, 'windowEnd');
    var valid = !(start == null) && !(end == null) && end > start;
    var tmp0_elvis_lhs = fromValue$positive(value, 'truncatedChannels');
    var truncated = tmp0_elvis_lhs == null ? 0 : tmp0_elvis_lhs;
    return new GuideCoverage(value.get_6bo4tg_k$('limited').kind_1.equals(ProviderValueKind_BOOLEAN_getInstance()) && value.get_6bo4tg_k$('limited').scalar_1 === 'true' || truncated > 0, valid ? start : null, valid ? end : null, fromValue$positive(value, 'programmeLimit'), truncated);
  };
  protoOf(Companion_12).parse_l2r7v4_k$ = function (fields) {
    var start = parse$number(fields, 'data-window-start');
    var end = parse$number(fields, 'data-window-end');
    var window_0 = !(start == null) && !(end == null) && end > start;
    var tmp0_safe_receiver = parse$number(fields, 'data-truncated-channels', true);
    var tmp1_elvis_lhs = tmp0_safe_receiver == null ? null : numberToInt(tmp0_safe_receiver);
    var truncated = tmp1_elvis_lhs == null ? 0 : tmp1_elvis_lhs;
    var tmp = fields.get_wei43m_k$('data-truncated') === 'true' || truncated > 0;
    var tmp_0 = window_0 ? start : null;
    var tmp_1 = window_0 ? end : null;
    var tmp2_safe_receiver = parse$number(fields, 'data-programme-limit', true);
    return new GuideCoverage(tmp, tmp_0, tmp_1, tmp2_safe_receiver == null ? null : numberToInt(tmp2_safe_receiver), truncated);
  };
  var Companion_instance_12;
  function Companion_getInstance_12() {
    return Companion_instance_12;
  }
  function GuideCoverage(limited, windowStart, windowEnd, programmeLimit, truncatedChannels) {
    limited = limited === VOID ? false : limited;
    windowStart = windowStart === VOID ? null : windowStart;
    windowEnd = windowEnd === VOID ? null : windowEnd;
    programmeLimit = programmeLimit === VOID ? null : programmeLimit;
    truncatedChannels = truncatedChannels === VOID ? 0 : truncatedChannels;
    this.limited_1 = limited;
    this.windowStart_1 = windowStart;
    this.windowEnd_1 = windowEnd;
    this.programmeLimit_1 = programmeLimit;
    this.truncatedChannels_1 = truncatedChannels;
  }
  protoOf(GuideCoverage).merge_qci9vf_k$ = function (other) {
    var tmp = this.limited_1 || other.limited_1 || (this.truncatedChannels_1 + other.truncatedChannels_1 | 0) > 0;
    var tmp_0 = minOrNull(listOfNotNull([this.windowStart_1, other.windowStart_1]));
    var tmp_1 = maxOrNull(listOfNotNull([this.windowEnd_1, other.windowEnd_1]));
    var tmp_2 = minOrNull_0(listOfNotNull([this.programmeLimit_1, other.programmeLimit_1]));
    // Inline function 'kotlin.comparisons.minOf' call
    var b = this.truncatedChannels_1 + other.truncatedChannels_1 | 0;
    var tmp$ret$0 = Math.min(50000, b);
    return new GuideCoverage(tmp, tmp_0, tmp_1, tmp_2, tmp$ret$0);
  };
  protoOf(GuideCoverage).toString = function () {
    return 'GuideCoverage(limited=' + this.limited_1 + ', windowStart=' + this.windowStart_1 + ', windowEnd=' + this.windowEnd_1 + ', programmeLimit=' + this.programmeLimit_1 + ', truncatedChannels=' + this.truncatedChannels_1 + ')';
  };
  protoOf(GuideCoverage).hashCode = function () {
    var result = getBooleanHashCode(this.limited_1);
    result = imul(result, 31) + (this.windowStart_1 == null ? 0 : getNumberHashCode(this.windowStart_1)) | 0;
    result = imul(result, 31) + (this.windowEnd_1 == null ? 0 : getNumberHashCode(this.windowEnd_1)) | 0;
    result = imul(result, 31) + (this.programmeLimit_1 == null ? 0 : this.programmeLimit_1) | 0;
    result = imul(result, 31) + this.truncatedChannels_1 | 0;
    return result;
  };
  protoOf(GuideCoverage).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof GuideCoverage))
      return false;
    if (!(this.limited_1 === other.limited_1))
      return false;
    if (!equals(this.windowStart_1, other.windowStart_1))
      return false;
    if (!equals(this.windowEnd_1, other.windowEnd_1))
      return false;
    if (!(this.programmeLimit_1 == other.programmeLimit_1))
      return false;
    if (!(this.truncatedChannels_1 === other.truncatedChannels_1))
      return false;
    return true;
  };
  function GuideStation(id, names, logo, sourceUrl) {
    var tmp;
    if (names === VOID) {
      // Inline function 'kotlin.collections.mutableListOf' call
      tmp = ArrayList_init_$Create$();
    } else {
      tmp = names;
    }
    names = tmp;
    logo = logo === VOID ? '' : logo;
    sourceUrl = sourceUrl === VOID ? null : sourceUrl;
    this.id_1 = id;
    this.names_1 = names;
    this.logo_1 = logo;
    this.sourceUrl_1 = sourceUrl;
  }
  protoOf(GuideStation).toString = function () {
    return 'GuideStation(id=' + this.id_1 + ', names=' + toString_1(this.names_1) + ', logo=' + this.logo_1 + ', sourceUrl=' + this.sourceUrl_1 + ')';
  };
  protoOf(GuideStation).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + hashCode_0(this.names_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.logo_1) | 0;
    result = imul(result, 31) + (this.sourceUrl_1 == null ? 0 : getStringHashCode(this.sourceUrl_1)) | 0;
    return result;
  };
  protoOf(GuideStation).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof GuideStation))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!equals(this.names_1, other.names_1))
      return false;
    if (!(this.logo_1 === other.logo_1))
      return false;
    if (!(this.sourceUrl_1 == other.sourceUrl_1))
      return false;
    return true;
  };
  function GuideRecord(channelId, start, end, title, slot, description, catchupId) {
    description = description === VOID ? '' : description;
    catchupId = catchupId === VOID ? '' : catchupId;
    this.channelId_1 = channelId;
    this.start_1 = start;
    this.end_1 = end;
    this.title_1 = title;
    this.slot_1 = slot;
    this.description_1 = description;
    this.catchupId_1 = catchupId;
  }
  protoOf(GuideRecord).copy_a6rrvg_k$ = function (channelId, start, end, title, slot, description, catchupId) {
    return new GuideRecord(channelId, start, end, title, slot, description, catchupId);
  };
  protoOf(GuideRecord).copy$default_f4e6qr_k$ = function (channelId, start, end, title, slot, description, catchupId, $super) {
    channelId = channelId === VOID ? this.channelId_1 : channelId;
    start = start === VOID ? this.start_1 : start;
    end = end === VOID ? this.end_1 : end;
    title = title === VOID ? this.title_1 : title;
    slot = slot === VOID ? this.slot_1 : slot;
    description = description === VOID ? this.description_1 : description;
    catchupId = catchupId === VOID ? this.catchupId_1 : catchupId;
    return $super === VOID ? this.copy_a6rrvg_k$(channelId, start, end, title, slot, description, catchupId) : $super.copy_a6rrvg_k$.call(this, channelId, start, end, title, slot, description, catchupId);
  };
  protoOf(GuideRecord).toString = function () {
    return 'GuideRecord(channelId=' + this.channelId_1 + ', start=' + this.start_1 + ', end=' + this.end_1 + ', title=' + this.title_1 + ', slot=' + this.slot_1 + ', description=' + this.description_1 + ', catchupId=' + this.catchupId_1 + ')';
  };
  protoOf(GuideRecord).hashCode = function () {
    var result = getStringHashCode(this.channelId_1);
    result = imul(result, 31) + getNumberHashCode(this.start_1) | 0;
    result = imul(result, 31) + (this.end_1 == null ? 0 : getNumberHashCode(this.end_1)) | 0;
    result = imul(result, 31) + getStringHashCode(this.title_1) | 0;
    result = imul(result, 31) + this.slot_1 | 0;
    result = imul(result, 31) + getStringHashCode(this.description_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.catchupId_1) | 0;
    return result;
  };
  protoOf(GuideRecord).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof GuideRecord))
      return false;
    if (!(this.channelId_1 === other.channelId_1))
      return false;
    if (!equals(this.start_1, other.start_1))
      return false;
    if (!equals(this.end_1, other.end_1))
      return false;
    if (!(this.title_1 === other.title_1))
      return false;
    if (!(this.slot_1 === other.slot_1))
      return false;
    if (!(this.description_1 === other.description_1))
      return false;
    if (!(this.catchupId_1 === other.catchupId_1))
      return false;
    return true;
  };
  function GuideRawStation(id, names, icons) {
    this.id_1 = id;
    this.names_1 = names;
    this.icons_1 = icons;
  }
  protoOf(GuideRawStation).toString = function () {
    return 'GuideRawStation(id=' + this.id_1 + ', names=' + toString_1(this.names_1) + ', icons=' + toString_1(this.icons_1) + ')';
  };
  protoOf(GuideRawStation).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + hashCode_0(this.names_1) | 0;
    result = imul(result, 31) + hashCode_0(this.icons_1) | 0;
    return result;
  };
  protoOf(GuideRawStation).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof GuideRawStation))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!equals(this.names_1, other.names_1))
      return false;
    if (!equals(this.icons_1, other.icons_1))
      return false;
    return true;
  };
  function GuideRawProgramme(channel, start, stop, title, description, catchupAttribute, catchupElement) {
    this.channel_1 = channel;
    this.start_1 = start;
    this.stop_1 = stop;
    this.title_1 = title;
    this.description_1 = description;
    this.catchupAttribute_1 = catchupAttribute;
    this.catchupElement_1 = catchupElement;
  }
  protoOf(GuideRawProgramme).toString = function () {
    return 'GuideRawProgramme(channel=' + this.channel_1 + ', start=' + this.start_1 + ', stop=' + this.stop_1 + ', title=' + this.title_1 + ', description=' + this.description_1 + ', catchupAttribute=' + this.catchupAttribute_1 + ', catchupElement=' + this.catchupElement_1 + ')';
  };
  protoOf(GuideRawProgramme).hashCode = function () {
    var result = getStringHashCode(this.channel_1);
    result = imul(result, 31) + getStringHashCode(this.start_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.stop_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.title_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.description_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.catchupAttribute_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.catchupElement_1) | 0;
    return result;
  };
  protoOf(GuideRawProgramme).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof GuideRawProgramme))
      return false;
    if (!(this.channel_1 === other.channel_1))
      return false;
    if (!(this.start_1 === other.start_1))
      return false;
    if (!(this.stop_1 === other.stop_1))
      return false;
    if (!(this.title_1 === other.title_1))
      return false;
    if (!(this.description_1 === other.description_1))
      return false;
    if (!(this.catchupAttribute_1 === other.catchupAttribute_1))
      return false;
    if (!(this.catchupElement_1 === other.catchupElement_1))
      return false;
    return true;
  };
  function addName$add($id, index, key) {
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(key) === 0)
      return Unit_instance;
    // Inline function 'kotlin.collections.getOrPut' call
    var value = index.get_wei43m_k$(key);
    var tmp;
    if (value == null) {
      // Inline function 'kotlin.collections.mutableListOf' call
      var answer = ArrayList_init_$Create$();
      index.put_4fpzoq_k$(key, answer);
      tmp = answer;
    } else {
      tmp = value;
    }
    var ids = tmp;
    if (!ids.contains_aljjnj_k$($id)) {
      ids.add_utx5q5_k$($id);
    }
  }
  function GuideCatalog() {
    var tmp = this;
    // Inline function 'kotlin.collections.mutableListOf' call
    tmp.channels_1 = ArrayList_init_$Create$();
    var tmp_0 = this;
    // Inline function 'kotlin.collections.mutableListOf' call
    tmp_0.programmes_1 = ArrayList_init_$Create$();
    var tmp_1 = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp_1.byChannel_1 = LinkedHashMap_init_$Create$();
    var tmp_2 = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp_2.byId_1 = LinkedHashMap_init_$Create$();
    var tmp_3 = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp_3.byName_1 = LinkedHashMap_init_$Create$();
    var tmp_4 = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp_4.byAlias_1 = LinkedHashMap_init_$Create$();
  }
  protoOf(GuideCatalog).addName_r6uhxg_k$ = function (name, id) {
    var exact = GuideNames_instance.normalized_qcj5er_k$(name);
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(exact) === 0)
      return Unit_instance;
    addName$add(id, this.byName_1, exact);
    addName$add(id, this.byAlias_1, GuideNames_instance.canonical_yvzfne_k$(name));
  };
  function GuideFeedInput(identity, sourceUrl, channels, scheduleIds, programmes, coverage, warnings) {
    this.identity_1 = identity;
    this.sourceUrl_1 = sourceUrl;
    this.channels_1 = channels;
    this.scheduleIds_1 = scheduleIds;
    this.programmes_1 = programmes;
    this.coverage_1 = coverage;
    this.warnings_1 = warnings;
  }
  protoOf(GuideFeedInput).toString = function () {
    return 'GuideFeedInput(identity=' + this.identity_1 + ', sourceUrl=' + this.sourceUrl_1 + ', channels=' + toString_1(this.channels_1) + ', scheduleIds=' + toString_1(this.scheduleIds_1) + ', programmes=' + toString_1(this.programmes_1) + ', coverage=' + this.coverage_1.toString() + ', warnings=' + toString_1(this.warnings_1) + ')';
  };
  protoOf(GuideFeedInput).hashCode = function () {
    var result = getStringHashCode(this.identity_1);
    result = imul(result, 31) + getStringHashCode(this.sourceUrl_1) | 0;
    result = imul(result, 31) + hashCode_0(this.channels_1) | 0;
    result = imul(result, 31) + hashCode_0(this.scheduleIds_1) | 0;
    result = imul(result, 31) + hashCode_0(this.programmes_1) | 0;
    result = imul(result, 31) + this.coverage_1.hashCode() | 0;
    result = imul(result, 31) + hashCode_0(this.warnings_1) | 0;
    return result;
  };
  protoOf(GuideFeedInput).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof GuideFeedInput))
      return false;
    if (!(this.identity_1 === other.identity_1))
      return false;
    if (!(this.sourceUrl_1 === other.sourceUrl_1))
      return false;
    if (!equals(this.channels_1, other.channels_1))
      return false;
    if (!equals(this.scheduleIds_1, other.scheduleIds_1))
      return false;
    if (!equals(this.programmes_1, other.programmes_1))
      return false;
    if (!this.coverage_1.equals(other.coverage_1))
      return false;
    if (!equals(this.warnings_1, other.warnings_1))
      return false;
    return true;
  };
  function GuideFeedGroup(identity, sourceUrl) {
    this.identity_1 = identity;
    this.sourceUrl_1 = sourceUrl;
    var tmp = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp.keys_1 = LinkedHashMap_init_$Create$();
    this.guide_1 = new GuideCatalog();
    var tmp_0 = this;
    // Inline function 'kotlin.collections.mutableSetOf' call
    tmp_0.seen_1 = LinkedHashSet_init_$Create$();
  }
  function GuideMerge(catalog, feeds, rawIds, coverage, warnings) {
    this.catalog_1 = catalog;
    this.feeds_1 = feeds;
    this.rawIds_1 = rawIds;
    this.coverage_1 = coverage;
    this.warnings_1 = warnings;
  }
  protoOf(GuideMerge).toString = function () {
    return 'GuideMerge(catalog=' + toString_1(this.catalog_1) + ', feeds=' + toString_1(this.feeds_1) + ', rawIds=' + toString_1(this.rawIds_1) + ', coverage=' + this.coverage_1.toString() + ', warnings=' + toString_1(this.warnings_1) + ')';
  };
  protoOf(GuideMerge).hashCode = function () {
    var result = hashCode_0(this.catalog_1);
    result = imul(result, 31) + hashCode_0(this.feeds_1) | 0;
    result = imul(result, 31) + hashCode_0(this.rawIds_1) | 0;
    result = imul(result, 31) + this.coverage_1.hashCode() | 0;
    result = imul(result, 31) + hashCode_0(this.warnings_1) | 0;
    return result;
  };
  protoOf(GuideMerge).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof GuideMerge))
      return false;
    if (!equals(this.catalog_1, other.catalog_1))
      return false;
    if (!equals(this.feeds_1, other.feeds_1))
      return false;
    if (!equals(this.rawIds_1, other.rawIds_1))
      return false;
    if (!this.coverage_1.equals(other.coverage_1))
      return false;
    if (!equals(this.warnings_1, other.warnings_1))
      return false;
    return true;
  };
  function GuideParsed(catalog, warnings) {
    this.catalog_1 = catalog;
    this.warnings_1 = warnings;
  }
  protoOf(GuideParsed).toString = function () {
    return 'GuideParsed(catalog=' + toString_1(this.catalog_1) + ', warnings=' + toString_1(this.warnings_1) + ')';
  };
  protoOf(GuideParsed).hashCode = function () {
    var result = hashCode_0(this.catalog_1);
    result = imul(result, 31) + hashCode_0(this.warnings_1) | 0;
    return result;
  };
  protoOf(GuideParsed).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof GuideParsed))
      return false;
    if (!equals(this.catalog_1, other.catalog_1))
      return false;
    if (!equals(this.warnings_1, other.warnings_1))
      return false;
    return true;
  };
  function sam$kotlin_Comparator$0_1(function_0) {
    this.function_1 = function_0;
  }
  protoOf(sam$kotlin_Comparator$0_1).compare_bczr_k$ = function (a, b) {
    return this.function_1(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_1).compare = function (a, b) {
    return this.compare_bczr_k$(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_1).getFunctionDelegate_jtodtf_k$ = function () {
    return this.function_1;
  };
  protoOf(sam$kotlin_Comparator$0_1).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, Comparator) : false) {
      var tmp_0;
      if (!(other == null) ? isInterface(other, FunctionAdapter) : false) {
        tmp_0 = equals(this.getFunctionDelegate_jtodtf_k$(), other.getFunctionDelegate_jtodtf_k$());
      } else {
        tmp_0 = false;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(sam$kotlin_Comparator$0_1).hashCode = function () {
    return hashCode_0(this.getFunctionDelegate_jtodtf_k$());
  };
  function sam$kotlin_Comparator$0_2(function_0) {
    this.function_1 = function_0;
  }
  protoOf(sam$kotlin_Comparator$0_2).compare_bczr_k$ = function (a, b) {
    return this.function_1(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_2).compare = function (a, b) {
    return this.compare_bczr_k$(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_2).getFunctionDelegate_jtodtf_k$ = function () {
    return this.function_1;
  };
  protoOf(sam$kotlin_Comparator$0_2).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, Comparator) : false) {
      var tmp_0;
      if (!(other == null) ? isInterface(other, FunctionAdapter) : false) {
        tmp_0 = equals(this.getFunctionDelegate_jtodtf_k$(), other.getFunctionDelegate_jtodtf_k$());
      } else {
        tmp_0 = false;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(sam$kotlin_Comparator$0_2).hashCode = function () {
    return hashCode_0(this.getFunctionDelegate_jtodtf_k$());
  };
  function sam$kotlin_Comparator$0_3(function_0) {
    this.function_1 = function_0;
  }
  protoOf(sam$kotlin_Comparator$0_3).compare_bczr_k$ = function (a, b) {
    return this.function_1(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_3).compare = function (a, b) {
    return this.compare_bczr_k$(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_3).getFunctionDelegate_jtodtf_k$ = function () {
    return this.function_1;
  };
  protoOf(sam$kotlin_Comparator$0_3).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, Comparator) : false) {
      var tmp_0;
      if (!(other == null) ? isInterface(other, FunctionAdapter) : false) {
        tmp_0 = equals(this.getFunctionDelegate_jtodtf_k$(), other.getFunctionDelegate_jtodtf_k$());
      } else {
        tmp_0 = false;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(sam$kotlin_Comparator$0_3).hashCode = function () {
    return hashCode_0(this.getFunctionDelegate_jtodtf_k$());
  };
  function keyOrder$index(value) {
    var tmp0_safe_receiver = toLongOrNull(value);
    var tmp;
    if (tmp0_safe_receiver == null) {
      tmp = null;
    } else {
      // Inline function 'kotlin.takeIf' call
      var tmp_0;
      if ((compare(new Long(0, 0), tmp0_safe_receiver) <= 0 ? compare(tmp0_safe_receiver, new Long(-2, 0)) <= 0 : false) && tmp0_safe_receiver.toString() === value) {
        tmp_0 = tmp0_safe_receiver;
      } else {
        tmp_0 = null;
      }
      tmp = tmp_0;
    }
    return tmp;
  }
  function GuideFeeds$keyOrder$lambda(a, b) {
    // Inline function 'kotlin.comparisons.compareValuesBy' call
    var tmp = keyOrder$index(a);
    var tmp$ret$2 = keyOrder$index(b);
    return compareValues(tmp, tmp$ret$2);
  }
  function GuideFeeds$chronological$lambda(a, b) {
    // Inline function 'kotlin.comparisons.compareValuesBy' call
    var tmp = a.start_1;
    var tmp$ret$2 = b.start_1;
    return compareValues(tmp, tmp$ret$2);
  }
  function GuideFeeds$chronological$lambda_0($this) {
    return function (a, b) {
      var previousCompare = $this.compare(a, b);
      var tmp;
      if (!(previousCompare === 0)) {
        tmp = previousCompare;
      } else {
        // Inline function 'kotlin.comparisons.compareValuesBy' call
        var tmp0_elvis_lhs = a.end_1;
        var tmp_0 = tmp0_elvis_lhs == null ? 0.0 : tmp0_elvis_lhs;
        var tmp0_elvis_lhs_0 = b.end_1;
        var tmp$ret$2 = tmp0_elvis_lhs_0 == null ? 0.0 : tmp0_elvis_lhs_0;
        tmp = compareValues(tmp_0, tmp$ret$2);
      }
      return tmp;
    };
  }
  function GuideFeeds$parse$lambda($this) {
    return function (a, b) {
      var previousCompare = $this.compare(a, b);
      var tmp;
      if (!(previousCompare === 0)) {
        tmp = previousCompare;
      } else {
        // Inline function 'kotlin.comparisons.compareValuesBy' call
        var tmp_0 = a.title_1;
        var tmp$ret$2 = b.title_1;
        tmp = compareValues(tmp_0, tmp$ret$2);
      }
      return tmp;
    };
  }
  function GuideFeeds$parse$lambda_0(a, b) {
    // Inline function 'kotlin.comparisons.compareValuesBy' call
    var tmp = a.start_1;
    var tmp$ret$2 = b.start_1;
    return compareValues(tmp, tmp$ret$2);
  }
  function GuideFeeds$parse$lambda_1($this) {
    return function (a, b) {
      var previousCompare = $this.compare(a, b);
      var tmp;
      if (!(previousCompare === 0)) {
        tmp = previousCompare;
      } else {
        // Inline function 'kotlin.comparisons.compareValuesBy' call
        var tmp_0 = a.channelId_1;
        var tmp$ret$2 = b.channelId_1;
        tmp = compareValues(tmp_0, tmp$ret$2);
      }
      return tmp;
    };
  }
  function choose$matches($candidates, $exists, alias, name) {
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(name) === 0)
      return emptyList();
    var values = $candidates(alias, name);
    return values.get_size_woubt6_k$() === 1 && !$exists(values.get_c1px32_k$(0)) ? emptyList() : values;
  }
  function GuideFeeds() {
    GuideFeeds_instance = this;
    var tmp = this;
    // Inline function 'kotlin.comparisons.compareBy' call
    var tmp_0 = GuideFeeds$chronological$lambda;
    // Inline function 'kotlin.comparisons.thenBy' call
    var this_0 = new sam$kotlin_Comparator$0_2(tmp_0);
    var tmp_1 = GuideFeeds$chronological$lambda_0(this_0);
    tmp.chronological_1 = new sam$kotlin_Comparator$0_2(tmp_1);
  }
  protoOf(GuideFeeds).keyOrder_uswrd2_k$ = function (keys) {
    // Inline function 'kotlin.collections.filter' call
    // Inline function 'kotlin.collections.filterTo' call
    var destination = ArrayList_init_$Create$();
    var _iterator__ex2g4s = keys.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      if (!(keyOrder$index(element) == null)) {
        destination.add_utx5q5_k$(element);
      }
    }
    // Inline function 'kotlin.collections.sortedBy' call
    // Inline function 'kotlin.comparisons.compareBy' call
    var tmp = GuideFeeds$keyOrder$lambda;
    var tmp$ret$4 = new sam$kotlin_Comparator$0_1(tmp);
    var tmp_0 = sortedWith(destination, tmp$ret$4);
    // Inline function 'kotlin.collections.filter' call
    // Inline function 'kotlin.collections.filterTo' call
    var destination_0 = ArrayList_init_$Create$();
    var _iterator__ex2g4s_0 = keys.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var element_0 = _iterator__ex2g4s_0.next_20eer_k$();
      if (keyOrder$index(element_0) == null) {
        destination_0.add_utx5q5_k$(element_0);
      }
    }
    return plus(tmp_0, destination_0);
  };
  protoOf(GuideFeeds).parse_ssjknu_k$ = function (stations, rows, icon) {
    var result = new GuideCatalog();
    // Inline function 'kotlin.collections.mutableListOf' call
    var warnings = ArrayList_init_$Create$();
    var _iterator__ex2g4s = stations.iterator_jk1svi_k$();
    $l$loop: while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var raw = _iterator__ex2g4s.next_20eer_k$();
      var id = CoreText_getInstance().trim$default_yjecrm_k$(raw.id_1);
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(id) === 0)
        continue $l$loop;
      // Inline function 'kotlin.collections.getOrPut' call
      var this_0 = result.byId_1;
      var value = this_0.get_wei43m_k$(id);
      var tmp;
      if (value == null) {
        // Inline function 'kotlin.also' call
        var this_1 = new GuideStation(id);
        result.channels_1.add_utx5q5_k$(this_1);
        var tmp0 = result.byChannel_1;
        // Inline function 'kotlin.collections.mutableListOf' call
        // Inline function 'kotlin.collections.set' call
        var value_0 = ArrayList_init_$Create$();
        tmp0.put_4fpzoq_k$(id, value_0);
        var answer = this_1;
        this_0.put_4fpzoq_k$(id, answer);
        tmp = answer;
      } else {
        tmp = value;
      }
      var channel = tmp;
      var _iterator__ex2g4s_0 = raw.names_1.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
        var name = _iterator__ex2g4s_0.next_20eer_k$();
        // Inline function 'kotlin.text.isNotEmpty' call
        var this_2 = GuideNames_instance.normalized_qcj5er_k$(name);
        if (charSequenceLength(this_2) > 0) {
          var trimmed = CoreText_getInstance().trim$default_yjecrm_k$(name);
          if (!channel.names_1.contains_aljjnj_k$(trimmed)) {
            channel.names_1.add_utx5q5_k$(trimmed);
          }
          result.addName_r6uhxg_k$(name, id);
        }
      }
      var _iterator__ex2g4s_1 = raw.icons_1.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
        var url = _iterator__ex2g4s_1.next_20eer_k$();
        // Inline function 'kotlin.text.isEmpty' call
        var this_3 = channel.logo_1;
        if (charSequenceLength(this_3) === 0)
          channel.logo_1 = icon(url);
      }
    }
    var iterator = rows.iterator_jk1svi_k$();
    var index = 0;
    $l$loop_0: while (iterator.hasNext_bitz1p_k$()) {
      var slot = index;
      index = index + 1 | 0;
      var raw_0 = iterator.next_20eer_k$();
      var id_0 = CoreText_getInstance().trim$default_yjecrm_k$(raw_0.channel_1);
      var tmp0_safe_receiver = GuideTime_getInstance().milliseconds_lcf5oq_k$(raw_0.start_1, GuideTimeFormat_BROWSER_getInstance());
      var start = tmp0_safe_receiver == null ? null : tmp0_safe_receiver / 1000;
      var tmp1_safe_receiver = GuideTime_getInstance().milliseconds_lcf5oq_k$(raw_0.stop_1, GuideTimeFormat_BROWSER_getInstance());
      var end = tmp1_safe_receiver == null ? null : tmp1_safe_receiver / 1000;
      var tmp_0;
      var tmp_1;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(id_0) === 0) {
        tmp_1 = true;
      } else {
        tmp_1 = start == null;
      }
      if (tmp_1) {
        tmp_0 = true;
      } else {
        var tmp_2;
        // Inline function 'kotlin.text.isNotEmpty' call
        var this_4 = raw_0.stop_1;
        if (charSequenceLength(this_4) > 0) {
          tmp_2 = end == null || end <= start;
        } else {
          tmp_2 = false;
        }
        tmp_0 = tmp_2;
      }
      if (tmp_0) {
        warnings.add_utx5q5_k$('Ignored a programme with invalid channel or time');
        continue $l$loop_0;
      }
      // Inline function 'kotlin.collections.getOrPut' call
      var this_5 = result.byChannel_1;
      var value_1 = this_5.get_wei43m_k$(id_0);
      var tmp_3;
      if (value_1 == null) {
        // Inline function 'kotlin.collections.mutableListOf' call
        var answer_0 = ArrayList_init_$Create$();
        this_5.put_4fpzoq_k$(id_0, answer_0);
        tmp_3 = answer_0;
      } else {
        tmp_3 = value_1;
      }
      var tmp_4 = tmp_3;
      var tmp_5 = CoreText_getInstance().trim$default_yjecrm_k$(raw_0.title_1);
      var tmp_6 = CoreText_getInstance().trim$default_yjecrm_k$(raw_0.description_1);
      // Inline function 'kotlin.text.ifEmpty' call
      var this_6 = CoreText_getInstance().trim$default_yjecrm_k$(raw_0.catchupAttribute_1);
      var tmp_7;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(this_6) === 0) {
        tmp_7 = CoreText_getInstance().trim$default_yjecrm_k$(raw_0.catchupElement_1);
      } else {
        tmp_7 = this_6;
      }
      var tmp$ret$15 = tmp_7;
      tmp_4.add_utx5q5_k$(new GuideRecord(id_0, start, end, tmp_5, slot, tmp_6, tmp$ret$15));
    }
    var _iterator__ex2g4s_2 = this.keyOrder_uswrd2_k$(result.byChannel_1.get_keys_wop4xp_k$()).iterator_jk1svi_k$();
    while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
      var id_1 = _iterator__ex2g4s_2.next_20eer_k$();
      var tmp_8 = getValue(result.byChannel_1, id_1);
      // Inline function 'kotlin.comparisons.thenBy' call
      var this_7 = this.chronological_1;
      var tmp_9 = GuideFeeds$parse$lambda(this_7);
      var tmp$ret$18 = new sam$kotlin_Comparator$0_3(tmp_9);
      var ordered = toMutableList(sortedWith(tmp_8, tmp$ret$18));
      var nextStart = null;
      var groupStart = null;
      var inductionVariable = ordered.get_size_woubt6_k$() - 1 | 0;
      if (0 <= inductionVariable)
        do {
          var index_0 = inductionVariable;
          inductionVariable = inductionVariable + -1 | 0;
          var entry = ordered.get_c1px32_k$(index_0);
          if (groupStart == null)
            groupStart = entry.start_1;
          else if (entry.start_1 < groupStart) {
            nextStart = groupStart;
            groupStart = entry.start_1;
          }
          if (entry.end_1 == null) {
            ordered.set_82063s_k$(index_0, entry.copy$default_f4e6qr_k$(VOID, VOID, nextStart));
          }
        }
         while (0 <= inductionVariable);
      // Inline function 'kotlin.collections.mutableSetOf' call
      var seen = LinkedHashSet_init_$Create$();
      // Inline function 'kotlin.collections.mutableListOf' call
      var retained = ArrayList_init_$Create$();
      var _iterator__ex2g4s_3 = ordered.iterator_jk1svi_k$();
      $l$loop_1: while (_iterator__ex2g4s_3.hasNext_bitz1p_k$()) {
        var entry_0 = _iterator__ex2g4s_3.next_20eer_k$();
        if (entry_0.end_1 == null || entry_0.end_1 <= entry_0.start_1) {
          warnings.add_utx5q5_k$('Ignored a programme without a known end time');
          continue $l$loop_1;
        }
        if (seen.add_utx5q5_k$(new Triple(entry_0.start_1, entry_0.end_1, entry_0.title_1))) {
          retained.add_utx5q5_k$(entry_0);
        }
      }
      // Inline function 'kotlin.collections.set' call
      result.byChannel_1.put_4fpzoq_k$(id_1, retained);
      result.programmes_1.addAll_h3ej1q_k$(retained);
    }
    // Inline function 'kotlin.comparisons.compareBy' call
    var tmp_10 = GuideFeeds$parse$lambda_0;
    // Inline function 'kotlin.comparisons.thenBy' call
    var this_8 = new sam$kotlin_Comparator$0_3(tmp_10);
    var tmp_11 = GuideFeeds$parse$lambda_1(this_8);
    var tmp$ret$23 = new sam$kotlin_Comparator$0_3(tmp_11);
    sortWith_0(result.programmes_1, tmp$ret$23);
    return new GuideParsed(result, warnings);
  };
  protoOf(GuideFeeds).merge_mhxzy4_k$ = function (inputs, qualify, logo) {
    // Inline function 'kotlin.collections.linkedMapOf' call
    var groups = LinkedHashMap_init_$Create$();
    var result = new GuideCatalog();
    // Inline function 'kotlin.collections.linkedMapOf' call
    var rawIds = LinkedHashMap_init_$Create$();
    var coverage = new GuideCoverage();
    // Inline function 'kotlin.collections.mutableListOf' call
    var warnings = ArrayList_init_$Create$();
    var _iterator__ex2g4s = inputs.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var input = _iterator__ex2g4s.next_20eer_k$();
      // Inline function 'kotlin.collections.getOrPut' call
      var key = input.identity_1;
      var value = groups.get_wei43m_k$(key);
      var tmp;
      if (value == null) {
        var answer = new GuideFeedGroup(input.identity_1, input.sourceUrl_1);
        groups.put_4fpzoq_k$(key, answer);
        tmp = answer;
      } else {
        tmp = value;
      }
      var group = tmp;
      coverage = coverage.merge_qci9vf_k$(input.coverage_1);
      // Inline function 'kotlin.collections.forEach' call
      var _iterator__ex2g4s_0 = input.scheduleIds_1.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s_0.next_20eer_k$();
        // Inline function 'kotlin.collections.getOrPut' call
        var this_0 = group.guide_1.byChannel_1;
        var value_0 = this_0.get_wei43m_k$(element);
        var tmp_0;
        if (value_0 == null) {
          // Inline function 'kotlin.collections.mutableListOf' call
          var answer_0 = ArrayList_init_$Create$();
          this_0.put_4fpzoq_k$(element, answer_0);
          tmp_0 = answer_0;
        } else {
          tmp_0 = value_0;
        }
      }
      var _iterator__ex2g4s_1 = input.channels_1.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
        var channel = _iterator__ex2g4s_1.next_20eer_k$();
        var tmp0 = group.guide_1.byId_1;
        // Inline function 'kotlin.collections.getOrPut' call
        var key_0 = channel.id_1;
        var value_1 = tmp0.get_wei43m_k$(key_0);
        var tmp_1;
        if (value_1 == null) {
          // Inline function 'kotlin.also' call
          var this_1 = new GuideStation(channel.id_1, VOID, VOID, group.sourceUrl_1);
          group.guide_1.channels_1.add_utx5q5_k$(this_1);
          var answer_1 = this_1;
          tmp0.put_4fpzoq_k$(key_0, answer_1);
          tmp_1 = answer_1;
        } else {
          tmp_1 = value_1;
        }
        var metadata = tmp_1;
        // Inline function 'kotlin.text.isEmpty' call
        var this_2 = metadata.logo_1;
        if (charSequenceLength(this_2) === 0)
          metadata.logo_1 = logo(channel.logo_1);
        var _iterator__ex2g4s_2 = channel.names_1.iterator_jk1svi_k$();
        while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
          var name = _iterator__ex2g4s_2.next_20eer_k$();
          if (!metadata.names_1.contains_aljjnj_k$(name)) {
            metadata.names_1.add_utx5q5_k$(name);
          }
          group.guide_1.addName_r6uhxg_k$(name, channel.id_1);
        }
      }
      var _iterator__ex2g4s_3 = input.programmes_1.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_3.hasNext_bitz1p_k$()) {
        var entry = _iterator__ex2g4s_3.next_20eer_k$();
        if (group.seen_1.add_utx5q5_k$(listOf_0([entry.channelId_1, entry.start_1, entry.end_1, entry.title_1]))) {
          var tmp0_0 = group.guide_1.byChannel_1;
          // Inline function 'kotlin.collections.getOrPut' call
          var key_1 = entry.channelId_1;
          var value_2 = tmp0_0.get_wei43m_k$(key_1);
          var tmp_2;
          if (value_2 == null) {
            // Inline function 'kotlin.collections.mutableListOf' call
            var answer_2 = ArrayList_init_$Create$();
            tmp0_0.put_4fpzoq_k$(key_1, answer_2);
            tmp_2 = answer_2;
          } else {
            tmp_2 = value_2;
          }
          tmp_2.add_utx5q5_k$(entry);
          group.guide_1.programmes_1.add_utx5q5_k$(entry);
        }
      }
      warnings.addAll_h3ej1q_k$(input.warnings_1);
    }
    var _iterator__ex2g4s_4 = groups.get_values_ksazhn_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_4.hasNext_bitz1p_k$()) {
      var group_0 = _iterator__ex2g4s_4.next_20eer_k$();
      var _iterator__ex2g4s_5 = this.keyOrder_uswrd2_k$(group_0.guide_1.byChannel_1.get_keys_wop4xp_k$()).iterator_jk1svi_k$();
      while (_iterator__ex2g4s_5.hasNext_bitz1p_k$()) {
        var id = _iterator__ex2g4s_5.next_20eer_k$();
        var key_2 = qualify(group_0.identity_1, id);
        // Inline function 'kotlin.collections.set' call
        group_0.keys_1.put_4fpzoq_k$(id, key_2);
        var rows = getValue(group_0.guide_1.byChannel_1, id);
        sortWith_0(rows, this.chronological_1);
        // Inline function 'kotlin.collections.set' call
        result.byChannel_1.put_4fpzoq_k$(key_2, rows);
        // Inline function 'kotlin.collections.getOrPut' call
        var value_3 = rawIds.get_wei43m_k$(id);
        var tmp_3;
        if (value_3 == null) {
          // Inline function 'kotlin.collections.mutableListOf' call
          var answer_3 = ArrayList_init_$Create$();
          rawIds.put_4fpzoq_k$(id, answer_3);
          tmp_3 = answer_3;
        } else {
          tmp_3 = value_3;
        }
        tmp_3.add_utx5q5_k$(key_2);
        var tmp0_elvis_lhs = group_0.guide_1.byId_1.get_wei43m_k$(id);
        var channel_0 = tmp0_elvis_lhs == null ? new GuideStation(id, VOID, VOID, group_0.sourceUrl_1) : tmp0_elvis_lhs;
        // Inline function 'kotlin.collections.set' call
        result.byId_1.put_4fpzoq_k$(key_2, channel_0);
        result.channels_1.add_utx5q5_k$(channel_0);
        // Inline function 'kotlin.collections.forEach' call
        var _iterator__ex2g4s_6 = channel_0.names_1.iterator_jk1svi_k$();
        while (_iterator__ex2g4s_6.hasNext_bitz1p_k$()) {
          var element_0 = _iterator__ex2g4s_6.next_20eer_k$();
          result.addName_r6uhxg_k$(element_0, key_2);
        }
      }
      result.programmes_1.addAll_h3ej1q_k$(group_0.guide_1.programmes_1);
    }
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_7 = rawIds.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_7.hasNext_bitz1p_k$()) {
      var _destruct__k2r9zo = _iterator__ex2g4s_7.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var id_0 = _destruct__k2r9zo.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var keys = _destruct__k2r9zo.get_value_j01efc_k$();
      var tmp_4;
      if (keys.get_size_woubt6_k$() === 1) {
        // Inline function 'kotlin.collections.contains' call
        // Inline function 'kotlin.collections.containsKey' call
        var this_3 = result.byChannel_1;
        tmp_4 = !(isInterface(this_3, KtMap) ? this_3 : THROW_CCE()).containsKey_aw81wo_k$(id_0);
      } else {
        tmp_4 = false;
      }
      if (tmp_4) {
        var tmp0_1 = result.byChannel_1;
        // Inline function 'kotlin.collections.set' call
        var value_4 = getValue(result.byChannel_1, keys.get_c1px32_k$(0));
        tmp0_1.put_4fpzoq_k$(id_0, value_4);
        var tmp0_2 = result.byId_1;
        // Inline function 'kotlin.collections.set' call
        var value_5 = getValue(result.byId_1, keys.get_c1px32_k$(0));
        tmp0_2.put_4fpzoq_k$(id_0, value_5);
      }
    }
    sortWith_0(result.programmes_1, this.chronological_1);
    return new GuideMerge(result, toList_0(groups.get_values_ksazhn_k$()), rawIds, coverage, warnings);
  };
  protoOf(GuideFeeds).chooseFeed_zg3jva_k$ = function (affinity, count, source, match, qualify) {
    var _iterator__ex2g4s = affinity.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var url = _iterator__ex2g4s.next_20eer_k$();
      var inductionVariable = 0;
      if (inductionVariable < count)
        do {
          var index = inductionVariable;
          inductionVariable = inductionVariable + 1 | 0;
          if (source(index) === url) {
            var id = match(index, false);
            // Inline function 'kotlin.text.isNullOrEmpty' call
            if (!(id == null || charSequenceLength(id) === 0))
              return qualify(index, id);
          }
        }
         while (inductionVariable < count);
    }
    // Inline function 'kotlin.collections.isNotEmpty' call
    return match(-1, !affinity.isEmpty_y1axqb_k$());
  };
  protoOf(GuideFeeds).choose_jx1efi_k$ = function (id, names, namesOnly, ids, candidates, exists) {
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(names, 10));
    var _iterator__ex2g4s = names.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = GuideNames_instance.normalized_qcj5er_k$(item);
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    var normalized = destination;
    var key = CoreText_getInstance().trim$default_yjecrm_k$(id);
    var tmp = GuideNames_instance;
    var tmp_0;
    var tmp_1;
    if (namesOnly) {
      tmp_1 = true;
    } else {
      // Inline function 'kotlin.text.isEmpty' call
      tmp_1 = charSequenceLength(key) === 0;
    }
    if (tmp_1) {
      tmp_0 = emptyList();
    } else {
      tmp_0 = ids(key);
    }
    var tmp_2 = tmp_0;
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination_0 = ArrayList_init_$Create$_0(collectionSizeOrDefault(normalized, 10));
    var _iterator__ex2g4s_0 = normalized.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var item_0 = _iterator__ex2g4s_0.next_20eer_k$();
      var tmp$ret$6 = choose$matches(candidates, exists, false, item_0);
      destination_0.add_utx5q5_k$(tmp$ret$6);
    }
    var tmp_3 = destination_0;
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination_1 = ArrayList_init_$Create$_0(collectionSizeOrDefault(normalized, 10));
    var _iterator__ex2g4s_1 = normalized.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
      var item_1 = _iterator__ex2g4s_1.next_20eer_k$();
      var tmp$ret$9 = choose$matches(candidates, exists, true, GuideNames_instance.canonical_yvzfne_k$(item_1));
      destination_1.add_utx5q5_k$(tmp$ret$9);
    }
    return tmp.chooseOrdered_naq0mk_k$(tmp_2, tmp_3, destination_1);
  };
  var GuideFeeds_instance;
  function GuideFeeds_getInstance() {
    if (GuideFeeds_instance == null)
      new GuideFeeds();
    return GuideFeeds_instance;
  }
  function quality($this, value) {
    switch (value) {
      case 'hd':
      case 'fhd':
      case 'uhd':
        return true;
      default:
        return value === '4k';
    }
  }
  function GuideNames() {
  }
  protoOf(GuideNames).normalized_qcj5er_k$ = function (value) {
    // Inline function 'kotlin.text.lowercase' call
    // Inline function 'kotlin.js.asDynamic' call
    return CoreText_getInstance().normalizedSpaces$default_3rlqo4_k$(value).toLowerCase();
  };
  protoOf(GuideNames).canonical_yvzfne_k$ = function (value) {
    return this.stripQuality_rxuzou_k$(this.normalized_qcj5er_k$(value));
  };
  protoOf(GuideNames).stripQuality_rxuzou_k$ = function (value) {
    var result = value;
    var first = indexOf_2(result, _Char___init__impl__6a9atx(32));
    if (first >= 0 && quality(this, substring(result, 0, first)))
      result = substring_0(result, first + 1 | 0);
    var last = lastIndexOf(result, _Char___init__impl__6a9atx(32));
    if (last >= 0 && quality(this, substring_0(result, last + 1 | 0)))
      result = substring(result, 0, last);
    return result;
  };
  protoOf(GuideNames).chooseOrdered_naq0mk_k$ = function (ids, exact, aliases) {
    var tmp0_safe_receiver = singleOrNull(ids);
    if (tmp0_safe_receiver == null)
      null;
    else {
      // Inline function 'kotlin.let' call
      return tmp0_safe_receiver;
    }
    var _iterator__ex2g4s = exact.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var candidates = _iterator__ex2g4s.next_20eer_k$();
      var tmp1_safe_receiver = singleOrNull(candidates);
      if (tmp1_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        return tmp1_safe_receiver;
      }
    }
    var _iterator__ex2g4s_0 = aliases.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var candidates_0 = _iterator__ex2g4s_0.next_20eer_k$();
      var tmp2_safe_receiver = singleOrNull(candidates_0);
      if (tmp2_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        return tmp2_safe_receiver;
      }
    }
    return null;
  };
  var GuideNames_instance;
  function GuideNames_getInstance() {
    return GuideNames_instance;
  }
  function GuideWindow(current, next, from, until) {
    this.current_1 = current;
    this.next_1 = next;
    this.from_1 = from;
    this.until_1 = until;
  }
  protoOf(GuideWindow).toString = function () {
    return 'GuideWindow(current=' + this.current_1 + ', next=' + this.next_1 + ', from=' + this.from_1 + ', until=' + this.until_1 + ')';
  };
  protoOf(GuideWindow).hashCode = function () {
    var result = this.current_1;
    result = imul(result, 31) + this.next_1 | 0;
    result = imul(result, 31) + getNumberHashCode(this.from_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.until_1) | 0;
    return result;
  };
  protoOf(GuideWindow).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof GuideWindow))
      return false;
    if (!(this.current_1 === other.current_1))
      return false;
    if (!(this.next_1 === other.next_1))
      return false;
    if (!equals(this.from_1, other.from_1))
      return false;
    if (!equals(this.until_1, other.until_1))
      return false;
    return true;
  };
  function GuideScheduleMemo() {
    this.window_1 = new GuideWindow(-1, -1, Infinity, -Infinity);
  }
  protoOf(GuideScheduleMemo).select_d15kz8_k$ = function (count, start, end, now) {
    if (!isFinite(now))
      return new GuideWindow(-1, -1, Infinity, -Infinity);
    if (now < this.window_1.from_1 || now >= this.window_1.until_1)
      this.window_1 = GuideSchedule_instance.select$default_3zhu62_k$(count, start, end, now);
    return this.window_1;
  };
  function GuideSchedule() {
  }
  protoOf(GuideSchedule).select_mlzbmh_k$ = function (count, start, end, now, openEnds) {
    if (!isFinite(now))
      return new GuideWindow(-1, -1, Infinity, -Infinity);
    var current = -1;
    var next = -1;
    var currentStart = -Infinity;
    var nextStart = Infinity;
    var from = -Infinity;
    var until = Infinity;
    var inductionVariable = 0;
    if (inductionVariable < count)
      $l$loop: do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        var begins = start(index);
        var ends = end(index);
        if (!isFinite(begins) || (!isFinite(ends) && !(openEnds && ends === Infinity)) || ends <= begins)
          continue $l$loop;
        if (begins <= now && now < ends && begins > currentStart) {
          current = index;
          currentStart = begins;
        }
        if (begins > now && begins < nextStart) {
          next = index;
          nextStart = begins;
        }
        if (begins <= now) {
          // Inline function 'kotlin.comparisons.maxOf' call
          var a = from;
          from = Math.max(a, begins);
        } else {
          // Inline function 'kotlin.comparisons.minOf' call
          var a_0 = until;
          until = Math.min(a_0, begins);
        }
        if (ends <= now) {
          // Inline function 'kotlin.comparisons.maxOf' call
          var a_1 = from;
          from = Math.max(a_1, ends);
        } else {
          // Inline function 'kotlin.comparisons.minOf' call
          var a_2 = until;
          until = Math.min(a_2, ends);
        }
      }
       while (inductionVariable < count);
    return new GuideWindow(current, next, from, until);
  };
  protoOf(GuideSchedule).select$default_3zhu62_k$ = function (count, start, end, now, openEnds, $super) {
    openEnds = openEnds === VOID ? false : openEnds;
    return $super === VOID ? this.select_mlzbmh_k$(count, start, end, now, openEnds) : $super.select_mlzbmh_k$.call(this, count, start, end, now, openEnds);
  };
  var GuideSchedule_instance;
  function GuideSchedule_getInstance() {
    return GuideSchedule_instance;
  }
  var static_init_called_1;
  function static_init_1() {
    if (static_init_called_1)
      return Unit_instance;
    static_init_called_1 = true;
    GuideTimeFormat_XMLTV_instance = new GuideTimeFormat('XMLTV', 0);
    GuideTimeFormat_BROWSER_instance = new GuideTimeFormat('BROWSER', 1);
    GuideTimeFormat_ANDROID_instance = new GuideTimeFormat('ANDROID', 2);
  }
  var GuideTimeFormat_XMLTV_instance;
  var GuideTimeFormat_BROWSER_instance;
  var GuideTimeFormat_ANDROID_instance;
  function GuideTimeFormat(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function NativeGuideClock(format, capacity) {
    capacity = capacity === VOID ? 4096 : capacity;
    this.format_1 = format;
    this.capacity_1 = capacity;
    var tmp = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    tmp.times_1 = LinkedHashMap_init_$Create$();
    var tmp_0 = this;
    // Inline function 'kotlin.comparisons.maxOf' call
    var b = this.capacity_1;
    // Inline function 'kotlin.arrayOfNulls' call
    var size = Math.max(0, b);
    tmp_0.keys_1 = Array(size);
    this.cursor_1 = 0;
  }
  protoOf(NativeGuideClock).seconds_rbj0rf_k$ = function (value) {
    var tmp0_safe_receiver = this.times_1.get_wei43m_k$(value);
    if (tmp0_safe_receiver == null)
      null;
    else {
      // Inline function 'kotlin.let' call
      return tmp0_safe_receiver;
    }
    var result = GuideTime_getInstance().nativeSeconds_3art00_k$(value, this.format_1);
    if (this.capacity_1 > 0 && value.length <= 64) {
      var tmp1_safe_receiver = this.keys_1[this.cursor_1];
      if (tmp1_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        this.times_1.remove_gppy8k_k$(tmp1_safe_receiver);
      }
      this.keys_1[this.cursor_1] = value;
      this.cursor_1 = (this.cursor_1 + 1 | 0) % this.capacity_1 | 0;
      // Inline function 'kotlin.collections.set' call
      this.times_1.put_4fpzoq_k$(value, result);
    }
    return result;
  };
  function milliseconds$field(digits, from, fallback) {
    fallback = fallback === VOID ? 0 : fallback;
    return digits.length >= (from + 2 | 0) ? toInt(substring(digits, from, from + 2 | 0)) : fallback;
  }
  function milliseconds$floorDiv(previous, divisor) {
    // Inline function 'kotlin.math.floor' call
    var x = previous / divisor;
    return Math.floor(x);
  }
  function GuideTime() {
    GuideTime_instance = this;
    var tmp = this;
    // Inline function 'kotlin.intArrayOf' call
    tmp.monthDays_1 = new Int32Array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  }
  protoOf(GuideTime).nativeSeconds_3art00_k$ = function (value, format) {
    var tmp = CoreText_getInstance();
    var input = tmp.trim_l1e112_k$(value, CoreText$unicodeSpace$ref(CoreText_getInstance()));
    if (input.length < 14)
      return 0.0;
    var dateEnd = 14;
    var date = substring(input, 0, 14);
    if (format.equals(NativeGuideFormat_SWIFT_getInstance())) {
      var digits = StringBuilder_init_$Create$_0();
      var index = 0;
      // Inline function 'kotlin.repeat' call
      var inductionVariable = 0;
      if (inductionVariable < 14)
        do {
          var index_0 = inductionVariable;
          inductionVariable = inductionVariable + 1 | 0;
          if (index >= input.length)
            return 0.0;
          var tmp0_elvis_lhs = CoreText_getInstance().digitAt_gwvjdq_k$(input, index);
          var tmp_0;
          if (tmp0_elvis_lhs == null) {
            return 0.0;
          } else {
            tmp_0 = tmp0_elvis_lhs;
          }
          var digit = tmp_0;
          digits.append_58al37_k$(Char__plus_impl_qi7pgj(_Char___init__impl__6a9atx(48), digit.first_1));
          index = index + digit.second_1 | 0;
        }
         while (inductionVariable < 14);
      date = digits.toString();
      dateEnd = index;
    }
    var tmp0 = date;
    var tmp$ret$2;
    $l$block: {
      // Inline function 'kotlin.text.any' call
      var inductionVariable_0 = 0;
      while (inductionVariable_0 < charSequenceLength(tmp0)) {
        var element = charSequenceGet(tmp0, inductionVariable_0);
        inductionVariable_0 = inductionVariable_0 + 1 | 0;
        if (!(_Char___init__impl__6a9atx(48) <= element ? element <= _Char___init__impl__6a9atx(57) : false)) {
          tmp$ret$2 = true;
          break $l$block;
        }
      }
      tmp$ret$2 = false;
    }
    if (tmp$ret$2)
      return 0.0;
    if (format.equals(NativeGuideFormat_RUST_getInstance()) && endsWith(date, '60'))
      date = dropLast(date, 2) + '59';
    var tmp0_elvis_lhs_0 = this.milliseconds$default_vkp5qz_k$(date);
    var tmp_1;
    if (tmp0_elvis_lhs_0 == null) {
      return 0.0;
    } else {
      tmp_1 = tmp0_elvis_lhs_0;
    }
    var millis = tmp_1;
    var tmp_2 = CoreText_getInstance();
    var tmp_3 = substring_0(input, dateEnd);
    var zone = tmp_2.trim_l1e112_k$(tmp_3, CoreText$unicodeSpace$ref(CoreText_getInstance()));
    var offset = 0;
    var tmp_4;
    var tmp_5;
    // Inline function 'kotlin.text.isNotEmpty' call
    if (charSequenceLength(zone) > 0) {
      tmp_5 = charCodeAt(zone, 0) === _Char___init__impl__6a9atx(43) || charCodeAt(zone, 0) === _Char___init__impl__6a9atx(45);
    } else {
      tmp_5 = false;
    }
    if (tmp_5) {
      tmp_4 = (format.equals(NativeGuideFormat_RUST_getInstance()) ? encodeToByteArray(zone).length : zone.length) >= 5;
    } else {
      tmp_4 = false;
    }
    if (tmp_4) {
      if (zone.length < 5)
        return 0.0;
      var tmp_6;
      if (format.equals(NativeGuideFormat_RUST_getInstance())) {
        var tmp0_0 = substring(zone, 1, 5);
        var tmp$ret$5;
        $l$block_0: {
          // Inline function 'kotlin.text.any' call
          var inductionVariable_1 = 0;
          while (inductionVariable_1 < charSequenceLength(tmp0_0)) {
            var element_0 = charSequenceGet(tmp0_0, inductionVariable_1);
            inductionVariable_1 = inductionVariable_1 + 1 | 0;
            if (!(_Char___init__impl__6a9atx(48) <= element_0 ? element_0 <= _Char___init__impl__6a9atx(57) : false)) {
              tmp$ret$5 = true;
              break $l$block_0;
            }
          }
          tmp$ret$5 = false;
        }
        tmp_6 = tmp$ret$5;
      } else {
        tmp_6 = false;
      }
      if (tmp_6)
        return 0.0;
      var tmp1_elvis_lhs = toIntOrNull(substring(zone, 1, 3));
      var hours = tmp1_elvis_lhs == null ? 0 : tmp1_elvis_lhs;
      var tmp2_elvis_lhs = toIntOrNull(substring(zone, 3, 5));
      var minutes = tmp2_elvis_lhs == null ? 0 : tmp2_elvis_lhs;
      offset = imul(imul(hours, 3600) + imul(minutes, 60) | 0, charCodeAt(zone, 0) === _Char___init__impl__6a9atx(45) ? -1 : 1);
    }
    return millis / 1000 - offset;
  };
  protoOf(GuideTime).parse_yvvfo7_k$ = function (value, format) {
    var tmp0_safe_receiver = this.milliseconds_lcf5oq_k$(value, format);
    return tmp0_safe_receiver == null ? null : numberToLong(tmp0_safe_receiver);
  };
  protoOf(GuideTime).milliseconds_lcf5oq_k$ = function (value, format) {
    var tmp = CoreText_getInstance();
    var tmp_0;
    if (format.equals(GuideTimeFormat_ANDROID_getInstance())) {
      tmp_0 = CoreText$androidSpace$ref(CoreText_getInstance());
    } else {
      tmp_0 = CoreText$space$ref(CoreText_getInstance());
    }
    var input = tmp.trim_l1e112_k$(value, tmp_0);
    var length = 0;
    $l$loop: while (true) {
      var tmp_1;
      if (length < input.length) {
        var containsArg = charCodeAt(input, length);
        tmp_1 = _Char___init__impl__6a9atx(48) <= containsArg ? containsArg <= _Char___init__impl__6a9atx(57) : false;
      } else {
        tmp_1 = false;
      }
      if (!tmp_1) {
        break $l$loop;
      }
      length = length + 1 | 0;
    }
    if (!(length === 8) && !(length === 10) && !(length === 12) && !(length === 14))
      return null;
    if (format.equals(GuideTimeFormat_BROWSER_getInstance()) && length < 12)
      return null;
    var digits = substring(input, 0, length);
    var year = toInt(substring(digits, 0, 4));
    var month = milliseconds$field(digits, 4);
    var day = milliseconds$field(digits, 6);
    var hour = milliseconds$field(digits, 8);
    var minute = milliseconds$field(digits, 10);
    var second = milliseconds$field(digits, 12);
    if (!(1 <= month ? month <= 12 : false) || hour > 23 || minute > 59 || second > 59)
      return null;
    var leap = (year % 4 | 0) === 0 && (!((year % 100 | 0) === 0) || (year % 400 | 0) === 0);
    if (!(1 <= day ? day <= (this.monthDays_1[month - 1 | 0] + (month === 2 && leap ? 1 : 0) | 0) : false))
      return null;
    var zoneStart = length;
    $l$loop_0: while (true) {
      var tmp_2;
      if (zoneStart < input.length) {
        var tmp_3;
        if (format.equals(GuideTimeFormat_ANDROID_getInstance())) {
          var tmp_4;
          if (charCodeAt(input, zoneStart) === _Char___init__impl__6a9atx(32)) {
            tmp_4 = true;
          } else {
            var containsArg_0 = charCodeAt(input, zoneStart);
            tmp_4 = _Char___init__impl__6a9atx(9) <= containsArg_0 ? containsArg_0 <= _Char___init__impl__6a9atx(13) : false;
          }
          tmp_3 = tmp_4;
        } else {
          tmp_3 = CoreText_getInstance().space_3ylfpz_k$(charCodeAt(input, zoneStart));
        }
        tmp_2 = tmp_3;
      } else {
        tmp_2 = false;
      }
      if (!tmp_2) {
        break $l$loop_0;
      }
      zoneStart = zoneStart + 1 | 0;
    }
    var zone = substring_0(input, zoneStart);
    if (format.equals(GuideTimeFormat_ANDROID_getInstance()) && (zone === 'UTC' || zone === 'GMT'))
      return null;
    var offset = 0;
    var tmp_5;
    var tmp_6;
    var tmp_7;
    // Inline function 'kotlin.text.isNotEmpty' call
    if (charSequenceLength(zone) > 0) {
      tmp_7 = !(zone === 'Z');
    } else {
      tmp_7 = false;
    }
    if (tmp_7) {
      tmp_6 = !(zone === 'UTC');
    } else {
      tmp_6 = false;
    }
    if (tmp_6) {
      tmp_5 = !(zone === 'GMT');
    } else {
      tmp_5 = false;
    }
    if (tmp_5) {
      if (!(zone.length === 5) && !(zone.length === 6) || (!(charCodeAt(zone, 0) === _Char___init__impl__6a9atx(43)) && !(charCodeAt(zone, 0) === _Char___init__impl__6a9atx(45))))
        return null;
      if (format.equals(GuideTimeFormat_BROWSER_getInstance()) && !(zone.length === 5))
        return null;
      var minuteStart = zone.length === 6 ? 4 : 3;
      if (zone.length === 6 && !(charCodeAt(zone, 3) === _Char___init__impl__6a9atx(58)))
        return null;
      var inductionVariable = 1;
      var last = zone.length;
      if (inductionVariable < last)
        $l$loop_1: do {
          var index = inductionVariable;
          inductionVariable = inductionVariable + 1 | 0;
          if (zone.length === 6 && index === 3)
            continue $l$loop_1;
          var containsArg_1 = charCodeAt(zone, index);
          if (!(_Char___init__impl__6a9atx(48) <= containsArg_1 ? containsArg_1 <= _Char___init__impl__6a9atx(57) : false))
            return null;
        }
         while (inductionVariable < last);
      var hours = toInt(substring(zone, 1, 3));
      var minutes = toInt(substring_0(zone, minuteStart));
      if (hours > 23 || minutes > 59)
        return null;
      if (format.equals(GuideTimeFormat_ANDROID_getInstance()) && (hours > 18 || (hours === 18 && !(minutes === 0))))
        return null;
      offset = imul(imul(hours, 60) + minutes | 0, charCodeAt(zone, 0) === _Char___init__impl__6a9atx(43) ? 1 : -1);
    }
    var previous = year - 1 | 0;
    var days = previous * 365 + milliseconds$floorDiv(previous, 4) - milliseconds$floorDiv(previous, 100) + milliseconds$floorDiv(previous, 400);
    var inductionVariable_0 = 0;
    var last_0 = month - 1 | 0;
    if (inductionVariable_0 < last_0)
      do {
        var index_0 = inductionVariable_0;
        inductionVariable_0 = inductionVariable_0 + 1 | 0;
        days = days + this.monthDays_1[index_0];
      }
       while (inductionVariable_0 < last_0);
    if (month > 2 && leap) {
      days = days + 1;
    }
    days = days + ((day - 1 | 0) - 719162 | 0);
    return ((days * 24 + hour) * 60 + minute - offset) * 60000 + imul(second, 1000);
  };
  protoOf(GuideTime).milliseconds$default_vkp5qz_k$ = function (value, format, $super) {
    format = format === VOID ? GuideTimeFormat_XMLTV_getInstance() : format;
    return $super === VOID ? this.milliseconds_lcf5oq_k$(value, format) : $super.milliseconds_lcf5oq_k$.call(this, value, format);
  };
  var GuideTime_instance;
  function GuideTime_getInstance() {
    if (GuideTime_instance == null)
      new GuideTime();
    return GuideTime_instance;
  }
  function GuideTimeFormat_XMLTV_getInstance() {
    static_init_1();
    return GuideTimeFormat_XMLTV_instance;
  }
  function GuideTimeFormat_BROWSER_getInstance() {
    static_init_1();
    return GuideTimeFormat_BROWSER_instance;
  }
  function GuideTimeFormat_ANDROID_getInstance() {
    static_init_1();
    return GuideTimeFormat_ANDROID_instance;
  }
  function LegacyStalkerEntry(id, name, epg, group, category, logo, url, mode, hours) {
    this.id_1 = id;
    this.name_1 = name;
    this.epg_1 = epg;
    this.group_1 = group;
    this.category_1 = category;
    this.logo_1 = logo;
    this.url_1 = url;
    this.mode_1 = mode;
    this.hours_1 = hours;
  }
  protoOf(LegacyStalkerEntry).toString = function () {
    return 'LegacyStalkerEntry(id=' + this.id_1 + ', name=' + toString_1(this.name_1) + ', epg=' + this.epg_1 + ', group=' + this.group_1 + ', category=' + this.category_1 + ', logo=' + toString_1(this.logo_1) + ', url=' + toString_1(this.url_1) + ', mode=' + this.mode_1 + ', hours=' + this.hours_1 + ')';
  };
  protoOf(LegacyStalkerEntry).hashCode = function () {
    var result = getNumberHashCode(this.id_1);
    result = imul(result, 31) + hashCode_0(this.name_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.epg_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.group_1) | 0;
    result = imul(result, 31) + this.category_1 | 0;
    result = imul(result, 31) + hashCode_0(this.logo_1) | 0;
    result = imul(result, 31) + hashCode_0(this.url_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.mode_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.hours_1) | 0;
    return result;
  };
  protoOf(LegacyStalkerEntry).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof LegacyStalkerEntry))
      return false;
    if (!equals(this.id_1, other.id_1))
      return false;
    if (!equals(this.name_1, other.name_1))
      return false;
    if (!(this.epg_1 === other.epg_1))
      return false;
    if (!(this.group_1 === other.group_1))
      return false;
    if (!(this.category_1 === other.category_1))
      return false;
    if (!equals(this.logo_1, other.logo_1))
      return false;
    if (!equals(this.url_1, other.url_1))
      return false;
    if (!(this.mode_1 === other.mode_1))
      return false;
    if (!equals(this.hours_1, other.hours_1))
      return false;
    return true;
  };
  function LegacyStalkerCatalog(entries, groups) {
    this.entries_1 = entries;
    this.groups_1 = groups;
  }
  protoOf(LegacyStalkerCatalog).toString = function () {
    return 'LegacyStalkerCatalog(entries=' + toString_1(this.entries_1) + ', groups=' + toString_1(this.groups_1) + ')';
  };
  protoOf(LegacyStalkerCatalog).hashCode = function () {
    var result = hashCode_0(this.entries_1);
    result = imul(result, 31) + hashCode_0(this.groups_1) | 0;
    return result;
  };
  protoOf(LegacyStalkerCatalog).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof LegacyStalkerCatalog))
      return false;
    if (!equals(this.entries_1, other.entries_1))
      return false;
    if (!equals(this.groups_1, other.groups_1))
      return false;
    return true;
  };
  function integer_0($this, value) {
    var input = CoreText_getInstance().trim$default_yjecrm_k$(value.string_er2cq7_k$());
    var negative = startsWith_0(input, _Char___init__impl__6a9atx(45));
    var unsigned = startsWith_0(input, _Char___init__impl__6a9atx(45)) || startsWith_0(input, _Char___init__impl__6a9atx(43)) ? drop_0(input, 1) : input;
    var tmp;
    if (startsWith(unsigned, '0x', true)) {
      var tmp_0 = CoreNumber_instance;
      var tmp0 = drop_0(unsigned, 2);
      var tmp$ret$0;
      $l$block: {
        // Inline function 'kotlin.text.takeWhile' call
        var inductionVariable = 0;
        var last = tmp0.length;
        if (inductionVariable < last)
          do {
            var index = inductionVariable;
            inductionVariable = inductionVariable + 1 | 0;
            var it = charCodeAt(tmp0, index);
            var tmp_1;
            if (_Char___init__impl__6a9atx(48) <= it ? it <= _Char___init__impl__6a9atx(57) : false) {
              tmp_1 = true;
            } else {
              // Inline function 'kotlin.text.lowercaseChar' call
              // Inline function 'kotlin.text.lowercase' call
              // Inline function 'kotlin.js.asDynamic' call
              // Inline function 'kotlin.js.unsafeCast' call
              var tmp$ret$3 = toString(it).toLowerCase();
              var containsArg = charCodeAt(tmp$ret$3, 0);
              tmp_1 = _Char___init__impl__6a9atx(97) <= containsArg ? containsArg <= _Char___init__impl__6a9atx(102) : false;
            }
            if (!tmp_1) {
              tmp$ret$0 = substring(tmp0, 0, index);
              break $l$block;
            }
          }
           while (inductionVariable < last);
        tmp$ret$0 = tmp0;
      }
      tmp = tmp_0.javascript_5uxq0d_k$('0x' + tmp$ret$0) * (negative ? -1 : 1);
    } else {
      tmp = ProviderPlaylist_instance.integer_6sycuc_k$(input);
    }
    var number = tmp;
    return isNaN_0(number) ? 0.0 : number;
  }
  function LegacyStalker(portal, mac) {
    this.portal_1 = portal;
    this.mac_1 = mac;
    this.stage_1 = 0;
    this.attempts_1 = 0;
    this.channels_1 = Companion_getInstance_13().missing_1;
  }
  protoOf(LegacyStalker).get_endpoint_30bvdu_k$ = function () {
    return trimEnd(this.portal_1, charArrayOf([_Char___init__impl__6a9atx(47)])) + '/stalker_portal/api/';
  };
  protoOf(LegacyStalker).get_request_jdwg4m_k$ = function () {
    return this.stage_1 === 2 ? null : this.api$default_ikamd8_k$(this.stage_1 === 0 ? 'handshake' : 'get_channels');
  };
  protoOf(LegacyStalker).api_ph4tw9_k$ = function (method, params) {
    return StalkerProtocol_instance.rpc_npxnyn_k$(method, this.mac_1, params, true);
  };
  protoOf(LegacyStalker).api$default_ikamd8_k$ = function (method, params, $super) {
    params = params === VOID ? emptyMap() : params;
    return $super === VOID ? this.api_ph4tw9_k$(method, params) : $super.api_ph4tw9_k$.call(this, method, params);
  };
  protoOf(LegacyStalker).accept_wd2l5t_k$ = function (response) {
    if (this.stage_1 === 0) {
      if (response.get_6bo4tg_k$('result').truthy_eb26j6_k$())
        this.stage_1 = 1;
      else {
        this.attempts_1 = this.attempts_1 + 1 | 0;
        if (this.attempts_1 === 2)
          throw new StalkerFailure('LEGACY_CONNECT');
      }
    } else {
      if (!response.get_6bo4tg_k$('result').truthy_eb26j6_k$())
        throw new StalkerFailure('LEGACY_CHANNELS');
      this.channels_1 = response.get_6bo4tg_k$('result');
      this.stage_1 = 2;
    }
  };
  protoOf(LegacyStalker).catalog_rtev1h_k$ = function (hash) {
    var rows = this.channels_1;
    if (rows.get_isObject_xg6v9u_k$()) {
      var selected = firstTruthy([rows.get_6bo4tg_k$('data'), rows.get_6bo4tg_k$('items'), rows.get_6bo4tg_k$('channels'), Companion_getInstance_13().array$default_yx37t8_k$()]);
      var tmp;
      if (selected.get_isArray_z8qxd2_k$()) {
        tmp = selected;
      } else {
        var tmp_0 = Companion_getInstance_13();
        // Inline function 'kotlin.collections.filter' call
        var tmp0 = rows.properties_1.get_values_ksazhn_k$();
        // Inline function 'kotlin.collections.filterTo' call
        var destination = ArrayList_init_$Create$();
        var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
        while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
          var element = _iterator__ex2g4s.next_20eer_k$();
          if (element.get_isObject_xg6v9u_k$() && element.get_6bo4tg_k$('name').truthy_eb26j6_k$()) {
            destination.add_utx5q5_k$(element);
          }
        }
        tmp = tmp_0.array_vqz2lg_k$(destination);
      }
      rows = tmp;
    }
    // Inline function 'kotlin.collections.mutableListOf' call
    var entries = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.mutableSetOf' call
    var seen = LinkedHashSet_init_$Create$();
    // Inline function 'kotlin.collections.linkedMapOf' call
    var groups = LinkedHashMap_init_$Create$();
    var _iterator__ex2g4s_0 = rows.elements_1.iterator_jk1svi_k$();
    $l$loop_0: while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var row = _iterator__ex2g4s_0.next_20eer_k$();
      if (!row.truthy_eb26j6_k$() || !row.get_6bo4tg_k$('name').truthy_eb26j6_k$())
        continue $l$loop_0;
      var id = row.get_6bo4tg_k$('id').truthy_eb26j6_k$() ? row.get_6bo4tg_k$('id').number_h3u0fr_k$() : hash(row.get_6bo4tg_k$('name'));
      var category = firstTruthy([row.get_6bo4tg_k$('genre'), row.get_6bo4tg_k$('categories'), row.get_6bo4tg_k$('category'), Companion_getInstance_13().text_yxj031_k$('Other')]);
      if (category.get_isArray_z8qxd2_k$()) {
        var tmp0_elvis_lhs = firstOrNull(category.elements_1);
        category = firstTruthy([tmp0_elvis_lhs == null ? Companion_getInstance_13().missing_1 : tmp0_elvis_lhs, Companion_getInstance_13().text_yxj031_k$('Other')]);
      }
      var group = category.kind_1.equals(ProviderValueKind_TEXT_getInstance()) ? category.scalar_1 : 'Other';
      var tmp_1;
      var tmp_2;
      // Inline function 'kotlin.text.isNotEmpty' call
      if (charSequenceLength(group) > 0) {
        tmp_2 = !(id === 0.0);
      } else {
        tmp_2 = false;
      }
      if (tmp_2) {
        tmp_1 = !isNaN_0(id);
      } else {
        tmp_1 = false;
      }
      if (tmp_1) {
        // Inline function 'kotlin.collections.getOrPut' call
        var value = groups.get_wei43m_k$(group);
        var tmp_3;
        if (value == null) {
          // Inline function 'kotlin.collections.mutableListOf' call
          var answer = ArrayList_init_$Create$();
          groups.put_4fpzoq_k$(group, answer);
          tmp_3 = answer;
        } else {
          tmp_3 = value;
        }
        tmp_3.add_utx5q5_k$(id);
      }
      if (!isNaN_0(id) && !seen.add_utx5q5_k$(id))
        continue $l$loop_0;
      var url = row.get_6bo4tg_k$('url').truthy_eb26j6_k$() ? row.get_6bo4tg_k$('url') : Companion_getInstance_13().text_yxj031_k$(trimEnd(this.portal_1, charArrayOf([_Char___init__impl__6a9atx(47)])) + '/stalker_portal/stream/' + row.get_6bo4tg_k$('id').string_er2cq7_k$() + '.m3u8?mac=' + this.mac_1);
      var logo = firstTruthy([row.get_6bo4tg_k$('logo'), row.get_6bo4tg_k$('icon'), row.get_6bo4tg_k$('tv_icon'), Companion_getInstance_13().text_yxj031_k$('')]);
      if (logo.kind_1.equals(ProviderValueKind_TEXT_getInstance()) && !startsWith(logo.scalar_1, 'http')) {
        if (startsWith(logo.scalar_1, '//'))
          logo = Companion_getInstance_13().text_yxj031_k$((startsWith(this.portal_1, 'https') ? 'https:' : 'http:') + logo.scalar_1);
        else if (startsWith_0(logo.scalar_1, _Char___init__impl__6a9atx(47)))
          logo = Companion_getInstance_13().text_yxj031_k$(trimEnd(this.portal_1, charArrayOf([_Char___init__impl__6a9atx(47)])) + logo.scalar_1);
      }
      // Inline function 'kotlin.takeIf' call
      var this_0 = integer_0(this, row.get_6bo4tg_k$('archive'));
      var tmp_4;
      if (!(this_0 === 0.0)) {
        tmp_4 = this_0;
      } else {
        tmp_4 = null;
      }
      var tmp1_elvis_lhs = tmp_4;
      var archive = tmp1_elvis_lhs == null ? integer_0(this, row.get_6bo4tg_k$('archive_duration')) : tmp1_elvis_lhs;
      entries.add_utx5q5_k$(new LegacyStalkerEntry(id, row.get_6bo4tg_k$('name'), firstTruthy([row.get_6bo4tg_k$('id'), row.get_6bo4tg_k$('ch_id'), Companion_getInstance_13().text_yxj031_k$('')]).string_er2cq7_k$(), group, indexOf_1(groups.get_keys_wop4xp_k$(), group) + 2 | 0, logo, url, row.get_6bo4tg_k$('archive').truthy_eb26j6_k$() ? 'append' : '', archive));
    }
    return new LegacyStalkerCatalog(entries, groups);
  };
  protoOf(LegacyStalker).guideRequest_82b3gw_k$ = function (channel, clock) {
    var tmp = to('ch_id', channel);
    var tmp_0 = ProviderValueKind_NUMBER_getInstance();
    // Inline function 'kotlin.math.floor' call
    var x = clock() - 86400;
    var tmp$ret$0 = Math.floor(x);
    var tmp_1 = to('from', new ProviderValue(tmp_0, numberToLong(tmp$ret$0).toString()));
    var tmp_2 = to('mac', Companion_getInstance_13().text_yxj031_k$(this.mac_1));
    var tmp_3 = ProviderValueKind_NUMBER_getInstance();
    // Inline function 'kotlin.math.floor' call
    var x_0 = clock() + 86400;
    var tmp$ret$1 = Math.floor(x_0);
    return this.api_ph4tw9_k$('get_epg', linkedMapOf([tmp, tmp_1, tmp_2, to('to', new ProviderValue(tmp_3, numberToLong(tmp$ret$1).toString()))]));
  };
  protoOf(LegacyStalker).guide_lhn7f_k$ = function (response) {
    var rows = response.get_6bo4tg_k$('result');
    if (!rows.get_isArray_z8qxd2_k$())
      return null;
    // Inline function 'kotlin.collections.mapNotNull' call
    var tmp0 = rows.elements_1;
    // Inline function 'kotlin.collections.mapNotNullTo' call
    var destination = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.forEach' call
    var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      // Inline function 'kotlin.takeIf' call
      var this_0 = integer_0(this, element.get_6bo4tg_k$('start_timestamp'));
      var tmp;
      if (!(this_0 === 0.0)) {
        tmp = this_0;
      } else {
        tmp = null;
      }
      var tmp0_elvis_lhs = tmp;
      var start = tmp0_elvis_lhs == null ? integer_0(this, element.get_6bo4tg_k$('start')) : tmp0_elvis_lhs;
      // Inline function 'kotlin.takeIf' call
      var this_1 = integer_0(this, element.get_6bo4tg_k$('end_timestamp'));
      var tmp_0;
      if (!(this_1 === 0.0)) {
        tmp_0 = this_1;
      } else {
        tmp_0 = null;
      }
      var tmp1_elvis_lhs = tmp_0;
      var end = tmp1_elvis_lhs == null ? integer_0(this, element.get_6bo4tg_k$('end')) : tmp1_elvis_lhs;
      var tmp0_safe_receiver = start === 0.0 || end === 0.0 ? null : new LegacyXtreamProgramme(firstTruthy([element.get_6bo4tg_k$('name'), element.get_6bo4tg_k$('title'), Companion_getInstance_13().text_yxj031_k$('No title')]), firstTruthy([element.get_6bo4tg_k$('descr'), element.get_6bo4tg_k$('description'), Companion_getInstance_13().text_yxj031_k$('')]), start, end);
      if (tmp0_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        destination.add_utx5q5_k$(tmp0_safe_receiver);
      }
    }
    return destination;
  };
  function LegacyXtreamEntry(id, name, providerId, category, group, logo, url) {
    this.id_1 = id;
    this.name_1 = name;
    this.providerId_1 = providerId;
    this.category_1 = category;
    this.group_1 = group;
    this.logo_1 = logo;
    this.url_1 = url;
  }
  protoOf(LegacyXtreamEntry).toString = function () {
    return 'LegacyXtreamEntry(id=' + this.id_1 + ', name=' + toString_1(this.name_1) + ', providerId=' + this.providerId_1 + ', category=' + this.category_1 + ', group=' + this.group_1 + ', logo=' + toString_1(this.logo_1) + ', url=' + this.url_1 + ')';
  };
  protoOf(LegacyXtreamEntry).hashCode = function () {
    var result = getNumberHashCode(this.id_1);
    result = imul(result, 31) + hashCode_0(this.name_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.providerId_1) | 0;
    result = imul(result, 31) + this.category_1 | 0;
    result = imul(result, 31) + getStringHashCode(this.group_1) | 0;
    result = imul(result, 31) + hashCode_0(this.logo_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.url_1) | 0;
    return result;
  };
  protoOf(LegacyXtreamEntry).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof LegacyXtreamEntry))
      return false;
    if (!equals(this.id_1, other.id_1))
      return false;
    if (!equals(this.name_1, other.name_1))
      return false;
    if (!(this.providerId_1 === other.providerId_1))
      return false;
    if (!(this.category_1 === other.category_1))
      return false;
    if (!(this.group_1 === other.group_1))
      return false;
    if (!equals(this.logo_1, other.logo_1))
      return false;
    if (!(this.url_1 === other.url_1))
      return false;
    return true;
  };
  function LegacyXtreamCatalog(entries, groups, groupOrder) {
    this.entries_1 = entries;
    this.groups_1 = groups;
    this.groupOrder_1 = groupOrder;
  }
  protoOf(LegacyXtreamCatalog).toString = function () {
    return 'LegacyXtreamCatalog(entries=' + toString_1(this.entries_1) + ', groups=' + toString_1(this.groups_1) + ', groupOrder=' + toString_1(this.groupOrder_1) + ')';
  };
  protoOf(LegacyXtreamCatalog).hashCode = function () {
    var result = hashCode_0(this.entries_1);
    result = imul(result, 31) + hashCode_0(this.groups_1) | 0;
    result = imul(result, 31) + hashCode_0(this.groupOrder_1) | 0;
    return result;
  };
  protoOf(LegacyXtreamCatalog).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof LegacyXtreamCatalog))
      return false;
    if (!equals(this.entries_1, other.entries_1))
      return false;
    if (!equals(this.groups_1, other.groups_1))
      return false;
    if (!equals(this.groupOrder_1, other.groupOrder_1))
      return false;
    return true;
  };
  function LegacyXtreamProgramme(name, description, start, end) {
    this.name_1 = name;
    this.description_1 = description;
    this.start_1 = start;
    this.end_1 = end;
  }
  protoOf(LegacyXtreamProgramme).toString = function () {
    return 'LegacyXtreamProgramme(name=' + toString_1(this.name_1) + ', description=' + toString_1(this.description_1) + ', start=' + this.start_1 + ', end=' + this.end_1 + ')';
  };
  protoOf(LegacyXtreamProgramme).hashCode = function () {
    var result = hashCode_0(this.name_1);
    result = imul(result, 31) + hashCode_0(this.description_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.start_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.end_1) | 0;
    return result;
  };
  protoOf(LegacyXtreamProgramme).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof LegacyXtreamProgramme))
      return false;
    if (!equals(this.name_1, other.name_1))
      return false;
    if (!equals(this.description_1, other.description_1))
      return false;
    if (!equals(this.start_1, other.start_1))
      return false;
    if (!equals(this.end_1, other.end_1))
      return false;
    return true;
  };
  function LegacyXtream() {
  }
  protoOf(LegacyXtream).guide_5n5fuv_k$ = function (response, clock) {
    if (!response.get_6bo4tg_k$('epg_listings').get_isArray_z8qxd2_k$())
      return null;
    // Inline function 'kotlin.collections.mapNotNull' call
    var tmp0 = response.get_6bo4tg_k$('epg_listings').elements_1;
    // Inline function 'kotlin.collections.mapNotNullTo' call
    var destination = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.forEach' call
    var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      var start = clock(element.get_6bo4tg_k$('start'));
      var end = clock(element.get_6bo4tg_k$('end'));
      var tmp0_safe_receiver = isNaN_0(start) || isNaN_0(end) ? null : new LegacyXtreamProgramme(element.get_6bo4tg_k$('title').truthy_eb26j6_k$() ? element.get_6bo4tg_k$('title') : Companion_getInstance_13().text_yxj031_k$('No title'), element.get_6bo4tg_k$('description').truthy_eb26j6_k$() ? element.get_6bo4tg_k$('description') : Companion_getInstance_13().text_yxj031_k$(''), start, end);
      if (tmp0_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        destination.add_utx5q5_k$(tmp0_safe_receiver);
      }
    }
    return destination;
  };
  protoOf(LegacyXtream).catalog_i7n7y4_k$ = function (data, addresses, hash) {
    // Inline function 'kotlin.collections.linkedMapOf' call
    var categories = LinkedHashMap_init_$Create$();
    var tmp0_safe_receiver = data.get_wei43m_k$('get_live_categories');
    // Inline function 'kotlin.collections.orEmpty' call
    var tmp0_elvis_lhs = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.elements_1;
    var _iterator__ex2g4s = (tmp0_elvis_lhs == null ? emptyList() : tmp0_elvis_lhs).iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var row = _iterator__ex2g4s.next_20eer_k$();
      var tmp2 = row.get_6bo4tg_k$('category_id').string_er2cq7_k$();
      // Inline function 'kotlin.collections.set' call
      var value = row.get_6bo4tg_k$('category_name').truthy_eb26j6_k$() ? row.get_6bo4tg_k$('category_name').string_er2cq7_k$() : 'Unknown';
      categories.put_4fpzoq_k$(tmp2, value);
    }
    // Inline function 'kotlin.collections.linkedMapOf' call
    var entries = LinkedHashMap_init_$Create$();
    // Inline function 'kotlin.collections.linkedMapOf' call
    var groups = LinkedHashMap_init_$Create$();
    // Inline function 'kotlin.collections.mutableMapOf' call
    var indexes = LinkedHashMap_init_$Create$();
    var tmp1_safe_receiver = data.get_wei43m_k$('get_live_streams');
    // Inline function 'kotlin.collections.orEmpty' call
    var tmp0_elvis_lhs_0 = tmp1_safe_receiver == null ? null : tmp1_safe_receiver.elements_1;
    var _iterator__ex2g4s_0 = (tmp0_elvis_lhs_0 == null ? emptyList() : tmp0_elvis_lhs_0).iterator_jk1svi_k$();
    $l$loop: while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var row_0 = _iterator__ex2g4s_0.next_20eer_k$();
      var name = row_0.get_6bo4tg_k$('name');
      var id = hash(name);
      // Inline function 'kotlin.text.orEmpty' call
      var tmp0_elvis_lhs_1 = categories.get_wei43m_k$(row_0.get_6bo4tg_k$('category_id').string_er2cq7_k$());
      // Inline function 'kotlin.text.ifEmpty' call
      var this_0 = tmp0_elvis_lhs_1 == null ? '' : tmp0_elvis_lhs_1;
      var tmp;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(this_0) === 0) {
        tmp = 'Other';
      } else {
        tmp = this_0;
      }
      var group = tmp;
      if (!(id === 0.0)) {
        // Inline function 'kotlin.collections.getOrPut' call
        var value_0 = groups.get_wei43m_k$(group);
        var tmp_0;
        if (value_0 == null) {
          // Inline function 'kotlin.collections.set' call
          var value_1 = groups.get_size_woubt6_k$() + 2 | 0;
          indexes.put_4fpzoq_k$(group, value_1);
          // Inline function 'kotlin.collections.mutableListOf' call
          var answer = ArrayList_init_$Create$();
          groups.put_4fpzoq_k$(group, answer);
          tmp_0 = answer;
        } else {
          tmp_0 = value_0;
        }
        tmp_0.add_utx5q5_k$(id);
      }
      // Inline function 'kotlin.collections.contains' call
      // Inline function 'kotlin.collections.containsKey' call
      if ((isInterface(entries, KtMap) ? entries : THROW_CCE()).containsKey_aw81wo_k$(id))
        continue $l$loop;
      var stream = row_0.get_6bo4tg_k$('stream_id').string_er2cq7_k$();
      var tmp2_elvis_lhs = indexes.get_wei43m_k$(group);
      // Inline function 'kotlin.collections.set' call
      var value_2 = new LegacyXtreamEntry(id, name, stream, tmp2_elvis_lhs == null ? 1 : tmp2_elvis_lhs, group, row_0.get_6bo4tg_k$('stream_icon').truthy_eb26j6_k$() ? row_0.get_6bo4tg_k$('stream_icon') : Companion_getInstance_13().text_yxj031_k$(''), addresses.legacyStream_4sx44x_k$(stream));
      entries.put_4fpzoq_k$(id, value_2);
    }
    return new LegacyXtreamCatalog(toList_0(entries.get_values_ksazhn_k$()), groups, toList_0(groups.get_keys_wop4xp_k$()));
  };
  var LegacyXtream_instance;
  function LegacyXtream_getInstance() {
    return LegacyXtream_instance;
  }
  var static_init_called_2;
  function static_init_2() {
    if (static_init_called_2)
      return Unit_instance;
    static_init_called_2 = true;
    NativeGuideFormat_RUST_instance = new NativeGuideFormat('RUST', 0);
    NativeGuideFormat_SWIFT_instance = new NativeGuideFormat('SWIFT', 1);
    NativeGuideFormat_ARCHIVED_ANDROID_instance = new NativeGuideFormat('ARCHIVED_ANDROID', 2);
    NativeGuideFormat_WEB_instance = new NativeGuideFormat('WEB', 3);
  }
  var NativeGuideFormat_RUST_instance;
  var NativeGuideFormat_SWIFT_instance;
  var NativeGuideFormat_ARCHIVED_ANDROID_instance;
  var NativeGuideFormat_WEB_instance;
  function values() {
    static_init_2();
    return [NativeGuideFormat_RUST_getInstance(), NativeGuideFormat_SWIFT_getInstance(), NativeGuideFormat_ARCHIVED_ANDROID_getInstance(), NativeGuideFormat_WEB_getInstance()];
  }
  function get_entries() {
    static_init_2();
    if ($ENTRIES == null)
      $ENTRIES = enumEntries(values());
    return $ENTRIES;
  }
  var $ENTRIES;
  function NativeGuideFormat(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function space($this, c, format) {
    switch (format.ordinal_1) {
      case 2:
        return CoreText_getInstance().asciiSpace_pupxmg_k$(c);
      case 3:
        return CoreText_getInstance().space_3ylfpz_k$(c);
      default:
        return CoreText_getInstance().unicodeSpace_yjjgmk_k$(c);
    }
  }
  function Shift(end, digits, sign) {
    this.end_1 = end;
    this.digits_1 = digits;
    this.sign_1 = sign;
  }
  protoOf(Shift).toString = function () {
    return 'Shift(end=' + this.end_1 + ', digits=' + this.digits_1 + ', sign=' + this.sign_1 + ')';
  };
  protoOf(Shift).hashCode = function () {
    var result = this.end_1;
    result = imul(result, 31) + getStringHashCode(this.digits_1) | 0;
    result = imul(result, 31) + this.sign_1 | 0;
    return result;
  };
  protoOf(Shift).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof Shift))
      return false;
    if (!(this.end_1 === other.end_1))
      return false;
    if (!(this.digits_1 === other.digits_1))
      return false;
    if (!(this.sign_1 === other.sign_1))
      return false;
    return true;
  };
  function shiftAt($this, value, start, format) {
    if (!(charCodeAt(value, start) === _Char___init__impl__6a9atx(43)) && !(charCodeAt(value, start) === _Char___init__impl__6a9atx(45)))
      return null;
    var end = start + 1 | 0;
    while (end < value.length && space($this, charCodeAt(value, end), format)) {
      end = end + 1 | 0;
    }
    var digits = end;
    $l$loop_0: while (end < value.length) {
      if (format.equals(NativeGuideFormat_ARCHIVED_ANDROID_getInstance()) || format.equals(NativeGuideFormat_WEB_getInstance())) {
        var containsArg = charCodeAt(value, end);
        if (!(_Char___init__impl__6a9atx(48) <= containsArg ? containsArg <= _Char___init__impl__6a9atx(57) : false))
          break $l$loop_0;
        end = end + 1 | 0;
      } else {
        var tmp0_elvis_lhs = CoreText_getInstance().digitAt_gwvjdq_k$(value, end);
        var tmp;
        if (tmp0_elvis_lhs == null) {
          break $l$loop_0;
        } else {
          tmp = tmp0_elvis_lhs;
        }
        var digit = tmp;
        end = end + digit.second_1 | 0;
      }
    }
    if (digits === end)
      return null;
    var number = substring(value, digits, end);
    while (end < value.length && space($this, charCodeAt(value, end), format)) {
      end = end + 1 | 0;
    }
    if (end < value.length && (charCodeAt(value, end) === _Char___init__impl__6a9atx(104) || charCodeAt(value, end) === _Char___init__impl__6a9atx(1095))) {
      end = end + 1 | 0;
    }
    return new Shift(end, number, charCodeAt(value, start) === _Char___init__impl__6a9atx(45) ? -1 : 1);
  }
  function NativeGuideNames$stripShift$lambda($format) {
    return function (it) {
      return space(NativeGuideNames_instance, it.value_1, $format);
    };
  }
  function NativeGuideNames$normalized$lambda($format) {
    return function (it) {
      return space(NativeGuideNames_instance, it.value_1, $format);
    };
  }
  function NativeGuideNames() {
  }
  protoOf(NativeGuideNames).stripShift_dpnto2_k$ = function (value, format) {
    var result = StringBuilder_init_$Create$_0();
    var index = 0;
    while (index < value.length) {
      var shift = shiftAt(this, value, index, format);
      if (shift == null) {
        var _unary__edvuaz = index;
        index = _unary__edvuaz + 1 | 0;
        result.append_58al37_k$(charCodeAt(value, _unary__edvuaz));
      } else {
        index = shift.end_1;
      }
    }
    var tmp = CoreText_getInstance();
    var tmp_0 = result.toString();
    return tmp.trim_l1e112_k$(tmp_0, NativeGuideNames$stripShift$lambda(format));
  };
  protoOf(NativeGuideNames).regionalShift_dpnawl_k$ = function (value, format) {
    var inductionVariable = 0;
    var last = charSequenceLength(value) - 1 | 0;
    if (inductionVariable <= last)
      $l$loop: do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        var tmp0_elvis_lhs = shiftAt(this, value, index, format);
        var tmp;
        if (tmp0_elvis_lhs == null) {
          continue $l$loop;
        } else {
          tmp = tmp0_elvis_lhs;
        }
        var shift = tmp;
        var tmp0 = shift.digits_1;
        var tmp$ret$0;
        $l$block: {
          // Inline function 'kotlin.text.any' call
          var inductionVariable_0 = 0;
          while (inductionVariable_0 < charSequenceLength(tmp0)) {
            var element = charSequenceGet(tmp0, inductionVariable_0);
            inductionVariable_0 = inductionVariable_0 + 1 | 0;
            if (!(_Char___init__impl__6a9atx(48) <= element ? element <= _Char___init__impl__6a9atx(57) : false)) {
              tmp$ret$0 = true;
              break $l$block;
            }
          }
          tmp$ret$0 = false;
        }
        if (tmp$ret$0)
          return 0;
        var tmp1_elvis_lhs = toLongOrNull(shift.digits_1);
        var tmp_0;
        if (tmp1_elvis_lhs == null) {
          return 0;
        } else {
          tmp_0 = tmp1_elvis_lhs;
        }
        var hours = tmp_0;
        if (format.equals(NativeGuideFormat_ARCHIVED_ANDROID_getInstance()) && compare(hours, new Long(2147483647, 0)) > 0)
          return 0;
        var tmp_1;
        if (compare(hours, new Long(24, 0)) > 0) {
          // Inline function 'kotlin.Long.rem' call
          tmp_1 = modulo(hours, fromInt(24));
        } else {
          tmp_1 = hours;
        }
        return imul(shift.sign_1, convertToInt(tmp_1));
      }
       while (inductionVariable <= last);
    return 0;
  };
  protoOf(NativeGuideNames).normalized_q2vtcv_k$ = function (value, format) {
    // Inline function 'kotlin.text.lowercase' call
    // Inline function 'kotlin.js.asDynamic' call
    var tmp$ret$0 = value.toLowerCase();
    var shifted = this.stripShift_dpnto2_k$(tmp$ret$0, format);
    var result = StringBuilder_init_$Create$_0();
    var index = 0;
    while (index < shifted.length) {
      var end = charCodeAt(shifted, index) === _Char___init__impl__6a9atx(40) ? indexOf_2(shifted, _Char___init__impl__6a9atx(41), index + 1 | 0) : -1;
      if (end < 0) {
        var _unary__edvuaz = index;
        index = _unary__edvuaz + 1 | 0;
        result.append_58al37_k$(charCodeAt(shifted, _unary__edvuaz));
      } else {
        index = end + 1 | 0;
      }
    }
    var tmp = CoreText_getInstance();
    var tmp_0 = result.toString();
    var collapsed = tmp.normalizedSpaces_bcspd8_k$(tmp_0, NativeGuideNames$normalized$lambda(format));
    var tmp_1 = GuideNames_instance;
    var tmp_2;
    if (format.equals(NativeGuideFormat_ARCHIVED_ANDROID_getInstance())) {
      var tmp_3 = CoreText_getInstance();
      tmp_2 = tmp_3.trim_l1e112_k$(collapsed, CoreText$androidSpace$ref(CoreText_getInstance()));
    } else {
      tmp_2 = collapsed;
    }
    return tmp_1.stripQuality_rxuzou_k$(tmp_2);
  };
  var NativeGuideNames_instance;
  function NativeGuideNames_getInstance() {
    return NativeGuideNames_instance;
  }
  function NativeGuideEntry(id, name) {
    this.id_1 = id;
    this.name_1 = name;
  }
  protoOf(NativeGuideEntry).toString = function () {
    return 'NativeGuideEntry(id=' + this.id_1 + ', name=' + this.name_1 + ')';
  };
  protoOf(NativeGuideEntry).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + getStringHashCode(this.name_1) | 0;
    return result;
  };
  protoOf(NativeGuideEntry).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof NativeGuideEntry))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    return true;
  };
  function NativeGuideMatch(id, score) {
    this.id_1 = id;
    this.score_1 = score;
  }
  protoOf(NativeGuideMatch).toString = function () {
    return 'NativeGuideMatch(id=' + this.id_1 + ', score=' + this.score_1 + ')';
  };
  protoOf(NativeGuideMatch).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + getNumberHashCode(this.score_1) | 0;
    return result;
  };
  protoOf(NativeGuideMatch).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof NativeGuideMatch))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!equals(this.score_1, other.score_1))
      return false;
    return true;
  };
  function Name(id, text, length, words) {
    this.id_1 = id;
    this.text_1 = text;
    this.length_1 = length;
    this.words_1 = words;
  }
  protoOf(Name).toString = function () {
    return 'Name(id=' + this.id_1 + ', text=' + this.text_1 + ', length=' + this.length_1 + ', words=' + toString_1(this.words_1) + ')';
  };
  protoOf(Name).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + getStringHashCode(this.text_1) | 0;
    result = imul(result, 31) + this.length_1 | 0;
    result = imul(result, 31) + hashCode_0(this.words_1) | 0;
    return result;
  };
  protoOf(Name).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof Name))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!(this.text_1 === other.text_1))
      return false;
    if (!(this.length_1 === other.length_1))
      return false;
    if (!equals(this.words_1, other.words_1))
      return false;
    return true;
  };
  function fuzzy($this, candidate) {
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(candidate) === 0)
      return null;
    var length = $this.measure_1(candidate);
    var words = toSet_0(split_0(candidate, charArrayOf([_Char___init__impl__6a9atx(32)])));
    var best = null;
    var _iterator__ex2g4s = $this.names_1.iterator_jk1svi_k$();
    $l$loop: while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var name = _iterator__ex2g4s.next_20eer_k$();
      var tmp;
      if (contains_1(candidate, name.text_1) || contains_1(name.text_1, candidate)) {
        // Inline function 'kotlin.comparisons.minOf' call
        var b = name.length_1;
        var tmp$ret$1 = Math.min(length, b);
        var tmp_0 = $this.precision_1(tmp$ret$1);
        // Inline function 'kotlin.comparisons.maxOf' call
        var b_0 = name.length_1;
        var tmp$ret$2 = Math.max(length, b_0);
        tmp = $this.precision_1(tmp_0 / $this.precision_1(tmp$ret$2));
      } else {
        var tmp$ret$3;
        $l$block: {
          // Inline function 'kotlin.collections.count' call
          var tmp_1;
          if (isInterface(words, Collection)) {
            tmp_1 = words.isEmpty_y1axqb_k$();
          } else {
            tmp_1 = false;
          }
          if (tmp_1) {
            tmp$ret$3 = 0;
            break $l$block;
          }
          var count = 0;
          var _iterator__ex2g4s_0 = words.iterator_jk1svi_k$();
          while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
            var element = _iterator__ex2g4s_0.next_20eer_k$();
            if (name.words_1.contains_aljjnj_k$(element)) {
              count = count + 1 | 0;
              checkCountOverflow(count);
            }
          }
          tmp$ret$3 = count;
        }
        var common = tmp$ret$3;
        var tmp0 = words.get_size_woubt6_k$();
        // Inline function 'kotlin.comparisons.minOf' call
        var b_1 = name.words_1.get_size_woubt6_k$();
        // Inline function 'kotlin.comparisons.maxOf' call
        var b_2 = Math.min(tmp0, b_1) / 2 | 0;
        if (common < Math.max(2, b_2))
          continue $l$loop;
        var tmp_2 = $this.precision_1(common);
        var tmp0_0 = words.get_size_woubt6_k$();
        // Inline function 'kotlin.comparisons.maxOf' call
        var b_3 = name.words_1.get_size_woubt6_k$();
        var tmp$ret$7 = Math.max(tmp0_0, b_3);
        tmp = $this.precision_1(tmp_2 / $this.precision_1(tmp$ret$7));
      }
      var score = tmp;
      var tmp_3;
      if (score >= $this.precision_1(0.4)) {
        var tmp0_safe_receiver = best;
        var tmp1_elvis_lhs = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.score_1;
        tmp_3 = score > (tmp1_elvis_lhs == null ? 0.0 : tmp1_elvis_lhs);
      } else {
        tmp_3 = false;
      }
      if (tmp_3)
        best = new NativeGuideMatch(name.id_1, score);
    }
    return best;
  }
  function NativeGuideIndex$_init_$lambda_1thg2q(it) {
    return it.length;
  }
  function NativeGuideIndex$_init_$lambda_1thg2q_0(it) {
    return it;
  }
  function NativeGuideIndex(entries, format, measure, precision) {
    format = format === VOID ? NativeGuideFormat_RUST_getInstance() : format;
    var tmp;
    if (measure === VOID) {
      tmp = NativeGuideIndex$_init_$lambda_1thg2q;
    } else {
      tmp = measure;
    }
    measure = tmp;
    var tmp_0;
    if (precision === VOID) {
      tmp_0 = NativeGuideIndex$_init_$lambda_1thg2q_0;
    } else {
      tmp_0 = precision;
    }
    precision = tmp_0;
    this.format_1 = format;
    this.measure_1 = measure;
    this.precision_1 = precision;
    var tmp_1 = this;
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(entries, 10));
    var _iterator__ex2g4s = entries.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = item.id_1;
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    tmp_1.ids_1 = toSet_0(destination);
    var tmp_2 = this;
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination_0 = ArrayList_init_$Create$_0(collectionSizeOrDefault(entries, 10));
    var _iterator__ex2g4s_0 = entries.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var item_0 = _iterator__ex2g4s_0.next_20eer_k$();
      var name = NativeGuideNames_instance.normalized_q2vtcv_k$(item_0.name_1, this.format_1);
      var tmp$ret$5 = new Name(item_0.id_1, name, this.measure_1(name), toSet_0(split_0(name, charArrayOf([_Char___init__impl__6a9atx(32)]))));
      destination_0.add_utx5q5_k$(tmp$ret$5);
    }
    // Inline function 'kotlin.collections.filter' call
    // Inline function 'kotlin.collections.filterTo' call
    var destination_1 = ArrayList_init_$Create$();
    var _iterator__ex2g4s_1 = destination_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s_1.next_20eer_k$();
      // Inline function 'kotlin.text.isNotEmpty' call
      var this_0 = element.text_1;
      if (charSequenceLength(this_0) > 0) {
        destination_1.add_utx5q5_k$(element);
      }
    }
    tmp_2.names_1 = destination_1;
    var tmp_3 = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    // Inline function 'kotlin.also' call
    var this_1 = LinkedHashMap_init_$Create$();
    var _iterator__ex2g4s_2 = this.names_1.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
      var name_0 = _iterator__ex2g4s_2.next_20eer_k$();
      // Inline function 'kotlin.collections.contains' call
      // Inline function 'kotlin.collections.containsKey' call
      var key = name_0.text_1;
      if (!(isInterface(this_1, KtMap) ? this_1 : THROW_CCE()).containsKey_aw81wo_k$(key)) {
        var tmp2 = name_0.text_1;
        // Inline function 'kotlin.collections.set' call
        var value = name_0.id_1;
        this_1.put_4fpzoq_k$(tmp2, value);
      }
    }
    tmp_3.exact_1 = this_1;
  }
  protoOf(NativeGuideIndex).match_m4pled_k$ = function (value) {
    var candidate = NativeGuideNames_instance.normalized_q2vtcv_k$(value, this.format_1);
    var tmp0_safe_receiver = this.exact_1.get_wei43m_k$(candidate);
    if (tmp0_safe_receiver == null)
      null;
    else {
      // Inline function 'kotlin.let' call
      return new NativeGuideMatch(tmp0_safe_receiver, 1.0);
    }
    return fuzzy(this, candidate);
  };
  protoOf(NativeGuideIndex).resolve_rchogc_k$ = function (id, candidates) {
    var tmp;
    // Inline function 'kotlin.text.isNotEmpty' call
    if (charSequenceLength(id) > 0) {
      tmp = this.ids_1.contains_aljjnj_k$(id);
    } else {
      tmp = false;
    }
    if (tmp)
      return id;
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(candidates, 10));
    var _iterator__ex2g4s = candidates.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$3 = NativeGuideNames_instance.normalized_q2vtcv_k$(item, this.format_1);
      destination.add_utx5q5_k$(tmp$ret$3);
    }
    var normalized = destination;
    var _iterator__ex2g4s_0 = normalized.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var name = _iterator__ex2g4s_0.next_20eer_k$();
      var tmp0_safe_receiver = this.exact_1.get_wei43m_k$(name);
      if (tmp0_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        return tmp0_safe_receiver;
      }
    }
    var best = null;
    var _iterator__ex2g4s_1 = normalized.iterator_jk1svi_k$();
    $l$loop: while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
      var name_0 = _iterator__ex2g4s_1.next_20eer_k$();
      var tmp1_elvis_lhs = fuzzy(this, name_0);
      var tmp_0;
      if (tmp1_elvis_lhs == null) {
        continue $l$loop;
      } else {
        tmp_0 = tmp1_elvis_lhs;
      }
      var next = tmp_0;
      var tmp2_safe_receiver = best;
      var tmp3_elvis_lhs = tmp2_safe_receiver == null ? null : tmp2_safe_receiver.score_1;
      if (next.score_1 > (tmp3_elvis_lhs == null ? 0.0 : tmp3_elvis_lhs))
        best = next;
    }
    var tmp4_safe_receiver = best;
    return tmp4_safe_receiver == null ? null : tmp4_safe_receiver.id_1;
  };
  function NativeGuideWindow(now, archiveHours, timeShiftHours) {
    this.shift_1 = timeShiftHours * 3600;
    this.from_1 = now - (archiveHours > 0 ? archiveHours : 48.0) * 3600;
    this.until_1 = now + 172800;
  }
  protoOf(NativeGuideWindow).includes_bqdor_k$ = function (start, stop) {
    return stop + this.shift_1 > this.from_1 && start + this.shift_1 < this.until_1;
  };
  function NativeGuideFormat_RUST_getInstance() {
    static_init_2();
    return NativeGuideFormat_RUST_instance;
  }
  function NativeGuideFormat_SWIFT_getInstance() {
    static_init_2();
    return NativeGuideFormat_SWIFT_instance;
  }
  function NativeGuideFormat_ARCHIVED_ANDROID_getInstance() {
    static_init_2();
    return NativeGuideFormat_ARCHIVED_ANDROID_instance;
  }
  function NativeGuideFormat_WEB_getInstance() {
    static_init_2();
    return NativeGuideFormat_WEB_instance;
  }
  var static_init_called_3;
  function static_init_3() {
    if (static_init_called_3)
      return Unit_instance;
    static_init_called_3 = true;
    NativeSourceFormat_SWIFT_instance = new NativeSourceFormat('SWIFT', 0);
    NativeSourceFormat_ANDROID_instance = new NativeSourceFormat('ANDROID', 1);
    NativeSourceFormat_ANDROID_RAW_instance = new NativeSourceFormat('ANDROID_RAW', 2);
  }
  var NativeSourceFormat_SWIFT_instance;
  var NativeSourceFormat_ANDROID_instance;
  var NativeSourceFormat_ANDROID_RAW_instance;
  function NativeSourceFormat(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  var static_init_called_4;
  function static_init_4() {
    if (static_init_called_4)
      return Unit_instance;
    static_init_called_4 = true;
    NativeCacheLookup_CACHE_instance = new NativeCacheLookup('CACHE', 0);
    NativeCacheLookup_JOIN_instance = new NativeCacheLookup('JOIN', 1);
    NativeCacheLookup_LOAD_instance = new NativeCacheLookup('LOAD', 2);
  }
  var NativeCacheLookup_CACHE_instance;
  var NativeCacheLookup_JOIN_instance;
  var NativeCacheLookup_LOAD_instance;
  function NativeCacheLookup(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  var static_init_called_5;
  function static_init_5() {
    if (static_init_called_5)
      return Unit_instance;
    static_init_called_5 = true;
    NativeCacheRefresh_STALE_instance = new NativeCacheRefresh('STALE', 0);
    NativeCacheRefresh_REPLACE_instance = new NativeCacheRefresh('REPLACE', 1);
    NativeCacheRefresh_FAIL_instance = new NativeCacheRefresh('FAIL', 2);
  }
  var NativeCacheRefresh_STALE_instance;
  var NativeCacheRefresh_REPLACE_instance;
  var NativeCacheRefresh_FAIL_instance;
  function NativeCacheRefresh(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function lookup($this, fresh, force, pending) {
    return !force && fresh ? NativeCacheLookup_CACHE_getInstance() : pending ? NativeCacheLookup_JOIN_getInstance() : NativeCacheLookup_LOAD_getInstance();
  }
  function NativeGuideSources() {
    this.DEFAULT_URL_1 = 'https://cdn.epg.one/epg2.xml.gz';
    this.TTL_1 = 7200;
  }
  protoOf(NativeGuideSources).urls_6o027a_k$ = function (supplied, single, bundled, format, trim, identity) {
    if (format.equals(NativeSourceFormat_ANDROID_RAW_getInstance())) {
      // Inline function 'kotlin.collections.filter' call
      var tmp0 = plus(listOf(single), supplied);
      // Inline function 'kotlin.collections.filterTo' call
      var destination = ArrayList_init_$Create$();
      var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        // Inline function 'kotlin.text.isNotBlank' call
        if (!isBlank(element)) {
          destination.add_utx5q5_k$(element);
        }
      }
      return distinct(destination);
    }
    var fallback = bundled ? listOf('https://cdn.epg.one/epg2.xml.gz') : emptyList();
    var tmp;
    if (format.equals(NativeSourceFormat_SWIFT_getInstance())) {
      var tmp_0;
      // Inline function 'kotlin.collections.isNotEmpty' call
      if (!supplied.isEmpty_y1axqb_k$()) {
        tmp_0 = supplied;
      } else {
        tmp_0 = listOf(single);
      }
      tmp = tmp_0;
    } else {
      // Inline function 'kotlin.collections.filter' call
      // Inline function 'kotlin.collections.filterTo' call
      var destination_0 = ArrayList_init_$Create$();
      var _iterator__ex2g4s_0 = supplied.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
        var element_0 = _iterator__ex2g4s_0.next_20eer_k$();
        // Inline function 'kotlin.text.isNotBlank' call
        if (!isBlank(element_0)) {
          destination_0.add_utx5q5_k$(element_0);
        }
      }
      // Inline function 'kotlin.collections.ifEmpty' call
      var tmp_1;
      if (destination_0.isEmpty_y1axqb_k$()) {
        tmp_1 = listOf(single);
      } else {
        tmp_1 = destination_0;
      }
      tmp = tmp_1;
    }
    var candidates = tmp;
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination_1 = ArrayList_init_$Create$_0(collectionSizeOrDefault(candidates, 10));
    var _iterator__ex2g4s_1 = candidates.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s_1.next_20eer_k$();
      destination_1.add_utx5q5_k$(trim(item));
    }
    // Inline function 'kotlin.collections.filter' call
    // Inline function 'kotlin.collections.filterTo' call
    var destination_2 = ArrayList_init_$Create$();
    var _iterator__ex2g4s_2 = destination_1.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
      var element_1 = _iterator__ex2g4s_2.next_20eer_k$();
      // Inline function 'kotlin.text.isNotEmpty' call
      if (charSequenceLength(element_1) > 0) {
        destination_2.add_utx5q5_k$(element_1);
      }
    }
    // Inline function 'kotlin.collections.distinctBy' call
    var set = HashSet_init_$Create$();
    var list = ArrayList_init_$Create$();
    var _iterator__ex2g4s_3 = destination_2.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_3.hasNext_bitz1p_k$()) {
      var e = _iterator__ex2g4s_3.next_20eer_k$();
      var key = identity(e);
      if (set.add_utx5q5_k$(key)) {
        list.add_utx5q5_k$(e);
      }
    }
    // Inline function 'kotlin.collections.ifEmpty' call
    var tmp_2;
    if (list.isEmpty_y1axqb_k$()) {
      tmp_2 = fallback;
    } else {
      tmp_2 = list;
    }
    return tmp_2;
  };
  protoOf(NativeGuideSources).unowned_jpm54w_k$ = function (existing, incoming, identity) {
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(existing, 10));
    var _iterator__ex2g4s = existing.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      destination.add_utx5q5_k$(identity(item));
    }
    var seen = toMutableSet(destination);
    // Inline function 'kotlin.collections.filter' call
    // Inline function 'kotlin.collections.filterTo' call
    var destination_0 = ArrayList_init_$Create$();
    var _iterator__ex2g4s_0 = incoming.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s_0.next_20eer_k$();
      if (seen.add_utx5q5_k$(identity(element))) {
        destination_0.add_utx5q5_k$(element);
      }
    }
    return destination_0;
  };
  protoOf(NativeGuideSources).fresh_w660h4_k$ = function (age) {
    return age < 7200;
  };
  protoOf(NativeGuideSources).lookup_lo9ey9_k$ = function (now, fetched, force, pending) {
    return lookup(this, !(fetched == null) && this.fresh_w660h4_k$(now - fetched), force, pending);
  };
  protoOf(NativeGuideSources).diskSwift_wifyxd_k$ = function (source, storedSource, now, fetched, stale) {
    return source === storedSource && (stale || this.fresh_w660h4_k$(now - fetched));
  };
  protoOf(NativeGuideSources).refresh_lm5uba_k$ = function (failed, empty, stale) {
    return stale && (failed || empty) ? NativeCacheRefresh_STALE_getInstance() : empty ? NativeCacheRefresh_FAIL_getInstance() : NativeCacheRefresh_REPLACE_getInstance();
  };
  protoOf(NativeGuideSources).evictSourceSet_idede3_k$ = function (count, existing) {
    return count >= 8 && !existing;
  };
  var NativeGuideSources_instance;
  function NativeGuideSources_getInstance() {
    return NativeGuideSources_instance;
  }
  function NativeSourceFormat_SWIFT_getInstance() {
    static_init_3();
    return NativeSourceFormat_SWIFT_instance;
  }
  function NativeSourceFormat_ANDROID_getInstance() {
    static_init_3();
    return NativeSourceFormat_ANDROID_instance;
  }
  function NativeSourceFormat_ANDROID_RAW_getInstance() {
    static_init_3();
    return NativeSourceFormat_ANDROID_RAW_instance;
  }
  function NativeCacheLookup_CACHE_getInstance() {
    static_init_4();
    return NativeCacheLookup_CACHE_instance;
  }
  function NativeCacheLookup_JOIN_getInstance() {
    static_init_4();
    return NativeCacheLookup_JOIN_instance;
  }
  function NativeCacheLookup_LOAD_getInstance() {
    static_init_4();
    return NativeCacheLookup_LOAD_instance;
  }
  function NativeCacheRefresh_STALE_getInstance() {
    static_init_5();
    return NativeCacheRefresh_STALE_instance;
  }
  function NativeCacheRefresh_REPLACE_getInstance() {
    static_init_5();
    return NativeCacheRefresh_REPLACE_instance;
  }
  function NativeCacheRefresh_FAIL_getInstance() {
    static_init_5();
    return NativeCacheRefresh_FAIL_instance;
  }
  var static_init_called_6;
  function static_init_6() {
    if (static_init_called_6)
      return Unit_instance;
    static_init_called_6 = true;
    NativeSourceLoadAction_READ_FRESH_DISK_instance = new NativeSourceLoadAction('READ_FRESH_DISK', 0);
    NativeSourceLoadAction_FETCH_instance = new NativeSourceLoadAction('FETCH', 1);
    NativeSourceLoadAction_WRITE_DISK_instance = new NativeSourceLoadAction('WRITE_DISK', 2);
    NativeSourceLoadAction_REPARSE_NETWORK_instance = new NativeSourceLoadAction('REPARSE_NETWORK', 3);
    NativeSourceLoadAction_READ_MEMORY_instance = new NativeSourceLoadAction('READ_MEMORY', 4);
    NativeSourceLoadAction_READ_STALE_DISK_instance = new NativeSourceLoadAction('READ_STALE_DISK', 5);
    NativeSourceLoadAction_USE_FRESH_DISK_instance = new NativeSourceLoadAction('USE_FRESH_DISK', 6);
    NativeSourceLoadAction_USE_NETWORK_instance = new NativeSourceLoadAction('USE_NETWORK', 7);
    NativeSourceLoadAction_USE_MEMORY_instance = new NativeSourceLoadAction('USE_MEMORY', 8);
    NativeSourceLoadAction_USE_STALE_DISK_instance = new NativeSourceLoadAction('USE_STALE_DISK', 9);
    NativeSourceLoadAction_FAIL_instance = new NativeSourceLoadAction('FAIL', 10);
  }
  var NativeSourceLoadAction_READ_FRESH_DISK_instance;
  var NativeSourceLoadAction_FETCH_instance;
  var NativeSourceLoadAction_WRITE_DISK_instance;
  var NativeSourceLoadAction_REPARSE_NETWORK_instance;
  var NativeSourceLoadAction_READ_MEMORY_instance;
  var NativeSourceLoadAction_READ_STALE_DISK_instance;
  var NativeSourceLoadAction_USE_FRESH_DISK_instance;
  var NativeSourceLoadAction_USE_NETWORK_instance;
  var NativeSourceLoadAction_USE_MEMORY_instance;
  var NativeSourceLoadAction_USE_STALE_DISK_instance;
  var NativeSourceLoadAction_FAIL_instance;
  function valueOf(value) {
    static_init_6();
    switch (value) {
      case 'READ_FRESH_DISK':
        return NativeSourceLoadAction_READ_FRESH_DISK_getInstance();
      case 'FETCH':
        return NativeSourceLoadAction_FETCH_getInstance();
      case 'WRITE_DISK':
        return NativeSourceLoadAction_WRITE_DISK_getInstance();
      case 'REPARSE_NETWORK':
        return NativeSourceLoadAction_REPARSE_NETWORK_getInstance();
      case 'READ_MEMORY':
        return NativeSourceLoadAction_READ_MEMORY_getInstance();
      case 'READ_STALE_DISK':
        return NativeSourceLoadAction_READ_STALE_DISK_getInstance();
      case 'USE_FRESH_DISK':
        return NativeSourceLoadAction_USE_FRESH_DISK_getInstance();
      case 'USE_NETWORK':
        return NativeSourceLoadAction_USE_NETWORK_getInstance();
      case 'USE_MEMORY':
        return NativeSourceLoadAction_USE_MEMORY_getInstance();
      case 'USE_STALE_DISK':
        return NativeSourceLoadAction_USE_STALE_DISK_getInstance();
      case 'FAIL':
        return NativeSourceLoadAction_FAIL_getInstance();
      default:
        THROW_IAE('No enum constant play.ott.core.NativeSourceLoadAction.' + value);
        break;
    }
  }
  function NativeSourceLoadAction(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function NativeSourceLoad() {
  }
  protoOf(NativeSourceLoad).start_4vcdj7_k$ = function (force) {
    return force ? NativeSourceLoadAction_FETCH_getInstance() : NativeSourceLoadAction_READ_FRESH_DISK_getInstance();
  };
  protoOf(NativeSourceLoad).next_ryrxq3_k$ = function (action, succeeded, channels, format) {
    // Inline function 'kotlin.require' call
    // Inline function 'kotlin.require' call
    if (!(format.equals(NativeSourceFormat_SWIFT_getInstance()) || format.equals(NativeSourceFormat_ANDROID_getInstance()))) {
      var message = 'Failed requirement.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    // Inline function 'kotlin.require' call
    // Inline function 'kotlin.require' call
    if (!(channels >= 0)) {
      var message_0 = 'Failed requirement.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message_0));
    }
    var usable = succeeded && channels > 0;
    var tmp;
    switch (action.ordinal_1) {
      case 0:
        tmp = usable ? NativeSourceLoadAction_USE_FRESH_DISK_getInstance() : NativeSourceLoadAction_FETCH_getInstance();
        break;
      case 1:
        tmp = usable ? NativeSourceLoadAction_WRITE_DISK_getInstance() : NativeSourceLoadAction_READ_MEMORY_getInstance();
        break;
      case 2:
        tmp = format.equals(NativeSourceFormat_ANDROID_getInstance()) ? NativeSourceLoadAction_USE_NETWORK_getInstance() : succeeded ? NativeSourceLoadAction_REPARSE_NETWORK_getInstance() : NativeSourceLoadAction_READ_MEMORY_getInstance();
        break;
      case 3:
        tmp = succeeded ? NativeSourceLoadAction_USE_NETWORK_getInstance() : NativeSourceLoadAction_FAIL_getInstance();
        break;
      case 4:
        tmp = succeeded ? NativeSourceLoadAction_USE_MEMORY_getInstance() : NativeSourceLoadAction_READ_STALE_DISK_getInstance();
        break;
      case 5:
        tmp = usable ? NativeSourceLoadAction_USE_STALE_DISK_getInstance() : NativeSourceLoadAction_FAIL_getInstance();
        break;
      default:
        // Inline function 'kotlin.error' call

        var message_1 = 'Native source load already completed';
        throw IllegalStateException_init_$Create$_0(toString_1(message_1));
    }
    return tmp;
  };
  var NativeSourceLoad_instance;
  function NativeSourceLoad_getInstance() {
    return NativeSourceLoad_instance;
  }
  function NativeSourceBatch(count) {
    this.count_1 = count;
    this.index_1 = 0;
    this.firstFailure_1 = -1;
    this.populated_1 = false;
    // Inline function 'kotlin.require' call
    // Inline function 'kotlin.require' call
    if (!(this.count_1 >= 0)) {
      var message = 'Failed requirement.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
  }
  protoOf(NativeSourceBatch).next_20eer_k$ = function () {
    return this.index_1 < this.count_1 ? this.index_1 : -1;
  };
  protoOf(NativeSourceBatch).advance_cfek05_k$ = function (succeeded, channels) {
    // Inline function 'kotlin.check' call
    if (!(this.index_1 < this.count_1)) {
      throw IllegalStateException_init_$Create$_0('Check failed.');
    }
    // Inline function 'kotlin.require' call
    // Inline function 'kotlin.require' call
    if (!(channels >= 0)) {
      var message = 'Failed requirement.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    if (succeeded)
      this.populated_1 = this.populated_1 || channels > 0;
    else if (this.firstFailure_1 < 0)
      this.firstFailure_1 = this.index_1;
    this.index_1 = this.index_1 + 1 | 0;
  };
  protoOf(NativeSourceBatch).failure_hyx20m_k$ = function () {
    // Inline function 'kotlin.check' call
    if (!(this.index_1 === this.count_1)) {
      throw IllegalStateException_init_$Create$_0('Check failed.');
    }
    return this.populated_1 ? -1 : this.firstFailure_1;
  };
  function NativeSourceLoadAction_READ_FRESH_DISK_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_READ_FRESH_DISK_instance;
  }
  function NativeSourceLoadAction_FETCH_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_FETCH_instance;
  }
  function NativeSourceLoadAction_WRITE_DISK_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_WRITE_DISK_instance;
  }
  function NativeSourceLoadAction_REPARSE_NETWORK_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_REPARSE_NETWORK_instance;
  }
  function NativeSourceLoadAction_READ_MEMORY_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_READ_MEMORY_instance;
  }
  function NativeSourceLoadAction_READ_STALE_DISK_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_READ_STALE_DISK_instance;
  }
  function NativeSourceLoadAction_USE_FRESH_DISK_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_USE_FRESH_DISK_instance;
  }
  function NativeSourceLoadAction_USE_NETWORK_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_USE_NETWORK_instance;
  }
  function NativeSourceLoadAction_USE_MEMORY_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_USE_MEMORY_instance;
  }
  function NativeSourceLoadAction_USE_STALE_DISK_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_USE_STALE_DISK_instance;
  }
  function NativeSourceLoadAction_FAIL_getInstance() {
    static_init_6();
    return NativeSourceLoadAction_FAIL_instance;
  }
  function OperatorEntry(id, name, generatedName, url, group, category, logo, epgId, epgName, hours, fallbackHours, mode, archive, feed, drm, server, token) {
    this.id_1 = id;
    this.name_1 = name;
    this.generatedName_1 = generatedName;
    this.url_1 = url;
    this.group_1 = group;
    this.category_1 = category;
    this.logo_1 = logo;
    this.epgId_1 = epgId;
    this.epgName_1 = epgName;
    this.hours_1 = hours;
    this.fallbackHours_1 = fallbackHours;
    this.mode_1 = mode;
    this.archive_1 = archive;
    this.feed_1 = feed;
    this.drm_1 = drm;
    this.server_1 = server;
    this.token_1 = token;
  }
  protoOf(OperatorEntry).toString = function () {
    return 'OperatorEntry(id=' + toString_0(this.id_1) + ', name=' + this.name_1 + ', generatedName=' + this.generatedName_1 + ', url=' + this.url_1 + ', group=' + this.group_1 + ', category=' + this.category_1 + ', logo=' + this.logo_1 + ', epgId=' + this.epgId_1 + ', epgName=' + this.epgName_1 + ', hours=' + this.hours_1 + ', fallbackHours=' + this.fallbackHours_1 + ', mode=' + this.mode_1 + ', archive=' + this.archive_1 + ', feed=' + this.feed_1 + ', drm=' + this.drm_1 + ', server=' + this.server_1 + ', token=' + this.token_1 + ')';
  };
  protoOf(OperatorEntry).hashCode = function () {
    var result = this.id_1 == null ? 0 : hashCode_0(this.id_1);
    result = imul(result, 31) + getStringHashCode(this.name_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.generatedName_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.url_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.group_1) | 0;
    result = imul(result, 31) + this.category_1 | 0;
    result = imul(result, 31) + getStringHashCode(this.logo_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.epgId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.epgName_1) | 0;
    result = imul(result, 31) + (this.hours_1 == null ? 0 : getNumberHashCode(this.hours_1)) | 0;
    result = imul(result, 31) + getStringHashCode(this.fallbackHours_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.mode_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.archive_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.feed_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.drm_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.server_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.token_1) | 0;
    return result;
  };
  protoOf(OperatorEntry).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof OperatorEntry))
      return false;
    if (!equals(this.id_1, other.id_1))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    if (!(this.generatedName_1 === other.generatedName_1))
      return false;
    if (!(this.url_1 === other.url_1))
      return false;
    if (!(this.group_1 === other.group_1))
      return false;
    if (!(this.category_1 === other.category_1))
      return false;
    if (!(this.logo_1 === other.logo_1))
      return false;
    if (!(this.epgId_1 === other.epgId_1))
      return false;
    if (!(this.epgName_1 === other.epgName_1))
      return false;
    if (!equals(this.hours_1, other.hours_1))
      return false;
    if (!(this.fallbackHours_1 === other.fallbackHours_1))
      return false;
    if (!(this.mode_1 === other.mode_1))
      return false;
    if (!(this.archive_1 === other.archive_1))
      return false;
    if (!(this.feed_1 === other.feed_1))
      return false;
    if (!(this.drm_1 === other.drm_1))
      return false;
    if (!(this.server_1 === other.server_1))
      return false;
    if (!(this.token_1 === other.token_1))
      return false;
    return true;
  };
  function OperatorCatalog(entries, groups, groupOrder, malformed) {
    malformed = malformed === VOID ? false : malformed;
    this.entries_1 = entries;
    this.groups_1 = groups;
    this.groupOrder_1 = groupOrder;
    this.malformed_1 = malformed;
  }
  protoOf(OperatorCatalog).toString = function () {
    return 'OperatorCatalog(entries=' + toString_1(this.entries_1) + ', groups=' + toString_1(this.groups_1) + ', groupOrder=' + toString_1(this.groupOrder_1) + ', malformed=' + this.malformed_1 + ')';
  };
  protoOf(OperatorCatalog).hashCode = function () {
    var result = hashCode_0(this.entries_1);
    result = imul(result, 31) + hashCode_0(this.groups_1) | 0;
    result = imul(result, 31) + hashCode_0(this.groupOrder_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.malformed_1) | 0;
    return result;
  };
  protoOf(OperatorCatalog).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof OperatorCatalog))
      return false;
    if (!equals(this.entries_1, other.entries_1))
      return false;
    if (!equals(this.groups_1, other.groups_1))
      return false;
    if (!equals(this.groupOrder_1, other.groupOrder_1))
      return false;
    if (!(this.malformed_1 === other.malformed_1))
      return false;
    return true;
  };
  function PlaylistMedia(name, generatedName, url, logo) {
    this.name_1 = name;
    this.generatedName_1 = generatedName;
    this.url_1 = url;
    this.logo_1 = logo;
  }
  protoOf(PlaylistMedia).toString = function () {
    return 'PlaylistMedia(name=' + this.name_1 + ', generatedName=' + this.generatedName_1 + ', url=' + this.url_1 + ', logo=' + this.logo_1 + ')';
  };
  protoOf(PlaylistMedia).hashCode = function () {
    var result = getStringHashCode(this.name_1);
    result = imul(result, 31) + getBooleanHashCode(this.generatedName_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.url_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.logo_1) | 0;
    return result;
  };
  protoOf(PlaylistMedia).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof PlaylistMedia))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    if (!(this.generatedName_1 === other.generatedName_1))
      return false;
    if (!(this.url_1 === other.url_1))
      return false;
    if (!(this.logo_1 === other.logo_1))
      return false;
    return true;
  };
  function attr($this, text, key) {
    return ProviderPlaylist_instance.attribute_s7yxes_k$(text, key);
  }
  function integer_1($this, text, key) {
    // Inline function 'kotlin.let' call
    var it = ProviderPlaylist_instance.integer_6sycuc_k$(attr($this, text, key));
    return isNaN_0(it) ? 0.0 : it;
  }
  function hours($this, text) {
    var tmp0 = listOf_0(['catchup-days', 'timeshift', 'tvg-rec']);
    var tmp$ret$0;
    $l$block: {
      // Inline function 'kotlin.collections.firstOrNull' call
      var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        if (contains_1(text, element)) {
          tmp$ret$0 = element;
          break $l$block;
        }
      }
      tmp$ret$0 = null;
    }
    var tmp0_safe_receiver = tmp$ret$0;
    var tmp;
    if (tmp0_safe_receiver == null) {
      tmp = null;
    } else {
      // Inline function 'kotlin.let' call
      tmp = integer_1(OperatorPlaylist_instance, text, tmp0_safe_receiver) * 24;
    }
    return tmp;
  }
  function mode($this, text) {
    // Inline function 'kotlin.text.ifEmpty' call
    var this_0 = attr($this, text, 'catchup');
    var tmp;
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(this_0) === 0) {
      tmp = attr(OperatorPlaylist_instance, text, 'catchup-type');
    } else {
      tmp = this_0;
    }
    return tmp;
  }
  function next($this, lines, comments) {
    var _iterator__ex2g4s = drop(lines, 1).iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var line = _iterator__ex2g4s.next_20eer_k$();
      var value = CoreText_getInstance().trim$default_yjecrm_k$(line);
      if (!comments || !startsWith_0(value, _Char___init__impl__6a9atx(35)))
        return value;
    }
    return '';
  }
  function read$addGroup(groups, categories, group, id) {
    var tmp;
    var tmp_0;
    var tmp_1;
    // Inline function 'kotlin.text.isNotEmpty' call
    if (charSequenceLength(group) > 0) {
      tmp_1 = !(id == null);
    } else {
      tmp_1 = false;
    }
    if (tmp_1) {
      tmp_0 = !equals(id, '');
    } else {
      tmp_0 = false;
    }
    if (tmp_0) {
      tmp = !equals(id, 0.0);
    } else {
      tmp = false;
    }
    if (tmp) {
      // Inline function 'kotlin.collections.getOrPut' call
      var value = groups.get_wei43m_k$(group);
      var tmp_2;
      if (value == null) {
        // Inline function 'kotlin.collections.set' call
        var value_0 = groups.get_size_woubt6_k$() + 2 | 0;
        categories.put_4fpzoq_k$(group, value_0);
        // Inline function 'kotlin.collections.mutableListOf' call
        var answer = ArrayList_init_$Create$();
        groups.put_4fpzoq_k$(group, answer);
        tmp_2 = answer;
      } else {
        tmp_2 = value;
      }
      tmp_2.add_utx5q5_k$(id);
    }
  }
  function OperatorPlaylist() {
  }
  protoOf(OperatorPlaylist).media_mdug2y_k$ = function (text) {
    // Inline function 'kotlin.collections.mapNotNull' call
    var tmp0 = drop(ProviderPlaylist_instance.blocks_90bblf_k$(text), 1);
    // Inline function 'kotlin.collections.mapNotNullTo' call
    var destination = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.forEach' call
    var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      var lines = split_0(element, charArrayOf([_Char___init__impl__6a9atx(10)]));
      var title = getOrNull_0(split_0(lines.get_c1px32_k$(0), charArrayOf([_Char___init__impl__6a9atx(44)])), 1);
      var url = next(OperatorPlaylist_instance, lines, true);
      var tmp;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(url) === 0) {
        tmp = null;
      } else {
        var tmp_0;
        if (title == null) {
          tmp_0 = null;
        } else {
          // Inline function 'kotlin.let' call
          tmp_0 = CoreText_getInstance().trim$default_yjecrm_k$(title);
        }
        // Inline function 'kotlin.text.orEmpty' call
        var tmp0_elvis_lhs = tmp_0;
        var tmp$ret$8 = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
        tmp = new PlaylistMedia(tmp$ret$8, title == null, url, attr(OperatorPlaylist_instance, lines.get_c1px32_k$(0), 'tvg-logo'));
      }
      var tmp0_safe_receiver = tmp;
      if (tmp0_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        destination.add_utx5q5_k$(tmp0_safe_receiver);
      }
    }
    return destination;
  };
  protoOf(OperatorPlaylist).read_orfpvl_k$ = function (text, profile, hash, existing) {
    // Inline function 'kotlin.require' call
    // Inline function 'kotlin.require' call
    if (!listOf_0(['1ott', 'only4', 'shara-tv', 'tvteam', 'antifriz', 'edem', 'kb-team', 'shura']).contains_aljjnj_k$(profile)) {
      var message = 'Failed requirement.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    var blocks = ProviderPlaylist_instance.blocks_90bblf_k$(text);
    var header = blocks.get_c1px32_k$(0);
    // Inline function 'kotlin.collections.linkedMapOf' call
    var groups = LinkedHashMap_init_$Create$();
    // Inline function 'kotlin.collections.mutableMapOf' call
    var categories = LinkedHashMap_init_$Create$();
    // Inline function 'kotlin.collections.linkedMapOf' call
    var entries = LinkedHashMap_init_$Create$();
    // Inline function 'kotlin.collections.mutableListOf' call
    var updates = ArrayList_init_$Create$();
    var previousGroup = '';
    var malformed = false;
    var extended = profile === 'edem' || profile === 'kb-team';
    var _iterator__ex2g4s = drop(blocks, 1).iterator_jk1svi_k$();
    $l$loop_3: while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var block = _iterator__ex2g4s.next_20eer_k$();
      var lines = split_0(block, charArrayOf([_Char___init__impl__6a9atx(10)]));
      var raw = lines.get_c1px32_k$(0);
      var url = next(this, lines, extended);
      var group = attr(this, raw, 'group-title');
      var tmp;
      if (profile === 'only4') {
        tmp = joinToString_0(take(drop(split_0(raw, charArrayOf([_Char___init__impl__6a9atx(44)])), 1), 100), ',');
      } else if (extended) {
        // Inline function 'kotlin.takeIf' call
        var this_0 = indexOf_2(raw, _Char___init__impl__6a9atx(44));
        var tmp_0;
        if (this_0 > 0) {
          tmp_0 = this_0;
        } else {
          tmp_0 = null;
        }
        var tmp0_safe_receiver = tmp_0;
        var tmp_1;
        if (tmp0_safe_receiver == null) {
          tmp_1 = null;
        } else {
          // Inline function 'kotlin.let' call
          tmp_1 = substring_0(raw, tmp0_safe_receiver + 1 | 0);
        }
        tmp = tmp_1;
      } else {
        tmp = getOrNull_0(split_0(raw, charArrayOf([_Char___init__impl__6a9atx(44)])), 1);
      }
      var tmp1_safe_receiver = tmp;
      var tmp_2;
      if (tmp1_safe_receiver == null) {
        tmp_2 = null;
      } else {
        // Inline function 'kotlin.let' call
        tmp_2 = CoreText_getInstance().trim$default_yjecrm_k$(tmp1_safe_receiver);
      }
      var title = tmp_2;
      if (profile === 'antifriz') {
        var segments = split_0(block, charArrayOf([_Char___init__impl__6a9atx(44)]));
        if (segments.get_size_woubt6_k$() < 2) {
          malformed = true;
          break $l$loop_3;
        }
        raw = segments.get_c1px32_k$(0);
        group = attr(this, raw, 'group-title');
        var content = split_0(segments.get_c1px32_k$(1), charArrayOf([_Char___init__impl__6a9atx(10)]));
        title = content.get_c1px32_k$(0);
        // Inline function 'kotlin.text.orEmpty' call
        var tmp0_elvis_lhs = getOrNull_0(content, 2);
        // Inline function 'kotlin.text.ifEmpty' call
        var this_1 = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
        var tmp_3;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_1) === 0) {
          // Inline function 'kotlin.text.orEmpty' call
          var tmp0_elvis_lhs_0 = getOrNull_0(content, 1);
          tmp_3 = tmp0_elvis_lhs_0 == null ? '' : tmp0_elvis_lhs_0;
        } else {
          tmp_3 = this_1;
        }
        url = tmp_3;
      } else if (extended) {
        var _iterator__ex2g4s_0 = drop(lines, 1).iterator_jk1svi_k$();
        $l$loop_0: while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
          var line = _iterator__ex2g4s_0.next_20eer_k$();
          var value = CoreText_getInstance().trim$default_yjecrm_k$(line);
          if (!startsWith_0(value, _Char___init__impl__6a9atx(35)))
            break $l$loop_0;
          var tmp_4;
          // Inline function 'kotlin.text.isEmpty' call
          var this_2 = group;
          if (charSequenceLength(this_2) === 0) {
            tmp_4 = contains_1(value, '#EXTGRP:');
          } else {
            tmp_4 = false;
          }
          if (tmp_4)
            group = CoreText_getInstance().trim$default_yjecrm_k$(substringBefore_0(substringAfter_0(value, '#EXTGRP:'), '#EXTGRP:'));
        }
        // Inline function 'kotlin.text.isEmpty' call
        var this_3 = group;
        if (charSequenceLength(this_3) === 0)
          group = previousGroup;
        else {
          previousGroup = group;
        }
      } else if ((profile === 'shara-tv' || profile === 'tvteam') && contains_1(url, '#EXTGRP:')) {
        if (lines.get_size_woubt6_k$() > 2)
          url = CoreText_getInstance().trim$default_yjecrm_k$(lines.get_c1px32_k$(2));
        // Inline function 'kotlin.text.isEmpty' call
        var this_4 = group;
        if (charSequenceLength(this_4) === 0)
          group = CoreText_getInstance().trim$default_yjecrm_k$(substringBefore_0(substringAfter_0(lines.get_c1px32_k$(1), '#EXTGRP:'), '#EXTGRP:'));
      }
      var parts = split_0(url, charArrayOf([_Char___init__impl__6a9atx(47)]));
      var epg = attr(this, raw, 'tvg-id');
      var epgName = attr(this, raw, 'tvg-name');
      var tmp_5;
      switch (profile) {
        case '1ott':
          // Inline function 'kotlin.text.orEmpty' call

          var tmp0_elvis_lhs_1 = getOrNull_0(parts, 4);
          // Inline function 'kotlin.text.ifEmpty' call

          var this_5 = tmp0_elvis_lhs_1 == null ? '' : tmp0_elvis_lhs_1;
          var tmp_6;
          // Inline function 'kotlin.text.isEmpty' call

          if (charSequenceLength(this_5) === 0) {
            tmp_6 = epg;
          } else {
            tmp_6 = this_5;
          }

          tmp_5 = tmp_6;
          break;
        case 'only4':
        case 'shara-tv':
          // Inline function 'kotlin.text.orEmpty' call

          var tmp0_elvis_lhs_2 = getOrNull_0(parts, 3);
          tmp_5 = tmp0_elvis_lhs_2 == null ? '' : tmp0_elvis_lhs_2;
          break;
        case 'tvteam':
          tmp_5 = epgName;
          break;
        case 'antifriz':
          // Inline function 'kotlin.text.orEmpty' call

          var tmp0_elvis_lhs_3 = getOrNull_0(parts, 5);
          var tmp$ret$26 = tmp0_elvis_lhs_3 == null ? '' : tmp0_elvis_lhs_3;
          tmp_5 = substringBefore(tmp$ret$26, _Char___init__impl__6a9atx(46));
          break;
        case 'edem':
          // Inline function 'kotlin.text.orEmpty' call

          var tmp0_elvis_lhs_4 = getOrNull_0(lines, 1);
          // Inline function 'kotlin.text.ifEmpty' call

          var this_6 = tmp0_elvis_lhs_4 == null ? '' : tmp0_elvis_lhs_4;
          var tmp_7;
          // Inline function 'kotlin.text.isEmpty' call

          if (charSequenceLength(this_6) === 0) {
            tmp_7 = url;
          } else {
            tmp_7 = this_6;
          }

          var tmp$ret$28 = tmp_7;
          tmp_5 = getOrNull_0(split_0(tmp$ret$28, charArrayOf([_Char___init__impl__6a9atx(47)])), 5);
          break;
        case 'kb-team':
          tmp_5 = hash(substringBefore(url, _Char___init__impl__6a9atx(63)));
          break;
        default:
          var tmp3_safe_receiver = getOrNull_0(lines, 1);
          var tmp4_safe_receiver = tmp3_safe_receiver == null ? null : split_0(tmp3_safe_receiver, charArrayOf([_Char___init__impl__6a9atx(47)]));
          tmp_5 = tmp4_safe_receiver == null ? null : getOrNull_0(tmp4_safe_receiver, 4);
          break;
      }
      var id = tmp_5;
      var tmp_8;
      if (profile === 'shura') {
        var tmp_9;
        var tmp_10;
        if (!(!(id == null) ? typeof id === 'string' : false)) {
          tmp_10 = true;
        } else {
          tmp_10 = !existing.contains_aljjnj_k$(id);
        }
        if (tmp_10) {
          tmp_9 = true;
        } else {
          // Inline function 'kotlin.text.isEmpty' call
          tmp_9 = charSequenceLength(id) === 0;
        }
        tmp_8 = tmp_9;
      } else {
        tmp_8 = false;
      }
      if (tmp_8)
        continue $l$loop_3;
      var tmp_11;
      // Inline function 'kotlin.text.isNotEmpty' call
      var this_7 = url;
      if (charSequenceLength(this_7) > 0) {
        tmp_11 = extended || (!(id == null) && !equals(id, ''));
      } else {
        tmp_11 = false;
      }
      var eligible = tmp_11;
      if (profile === 'shara-tv' && (!eligible || entries.containsKey_aw81wo_k$(id)) || (listOf_0(['tvteam', 'antifriz']).contains_aljjnj_k$(profile) && !eligible))
        continue $l$loop_3;
      read$addGroup(groups, categories, group, id);
      if (!(profile === 'shura') && (!eligible || entries.containsKey_aw81wo_k$(id)))
        continue $l$loop_3;
      // Inline function 'kotlin.let' call
      var it = attr(this, raw, 'tvg-logo');
      var logo = profile === 'antifriz' ? CoreText_getInstance().replaceLiteralFirst_r86yx1_k$(it, 'https:', 'http:') : extended && !startsWith(it, '//') && !startsWith(it, 'http', true) ? '' : it;
      var tmp_12;
      if (extended) {
        var tmp5_elvis_lhs = hours(this, raw);
        tmp_12 = tmp5_elvis_lhs == null ? hours(this, header) : tmp5_elvis_lhs;
      } else if (profile === 'tvteam') {
        tmp_12 = integer_1(this, raw, 'timeshift') * 168;
      } else if (profile === 'antifriz') {
        tmp_12 = integer_1(this, raw, 'tvg-rec') * 24;
      } else {
        tmp_12 = integer_1(this, raw, 'catchup-days') * 24;
      }
      var hours_0 = tmp_12;
      // Inline function 'kotlin.text.orEmpty' call
      var tmp0_elvis_lhs_5 = title;
      var tmp_13 = tmp0_elvis_lhs_5 == null ? '' : tmp0_elvis_lhs_5;
      var tmp_14 = title == null;
      var tmp_15 = url;
      var tmp_16 = group;
      var tmp6_elvis_lhs = categories.get_wei43m_k$(group);
      var tmp_17 = tmp6_elvis_lhs == null ? 1 : tmp6_elvis_lhs;
      var tmp_18 = profile === 'edem' ? '0' : '';
      var tmp_19;
      if (extended) {
        // Inline function 'kotlin.text.ifEmpty' call
        var this_8 = mode(this, raw);
        var tmp_20;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_8) === 0) {
          tmp_20 = mode(OperatorPlaylist_instance, header);
        } else {
          tmp_20 = this_8;
        }
        tmp_19 = tmp_20;
      } else {
        tmp_19 = '';
      }
      var tmp_21 = tmp_19;
      // Inline function 'kotlin.text.ifEmpty' call
      var this_9 = attr(this, raw, 'catchup-source');
      var tmp_22;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(this_9) === 0) {
        tmp_22 = extended ? attr(OperatorPlaylist_instance, header, 'catchup-source') : '';
      } else {
        tmp_22 = this_9;
      }
      var tmp_23 = tmp_22;
      var tmp_24;
      if (extended) {
        // Inline function 'kotlin.text.ifEmpty' call
        var this_10 = attr(this, raw, 'url-tvg');
        var tmp_25;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_10) === 0) {
          var tmp_26;
          if (profile === 'kb-team') {
            tmp_26 = 'kbc';
          } else {
            // Inline function 'kotlin.text.ifEmpty' call
            var this_11 = attr(OperatorPlaylist_instance, header, 'url-tvg');
            var tmp_27;
            // Inline function 'kotlin.text.isEmpty' call
            if (charSequenceLength(this_11) === 0) {
              tmp_27 = attr(OperatorPlaylist_instance, header, 'x-tvg-url');
            } else {
              tmp_27 = this_11;
            }
            tmp_26 = tmp_27;
          }
          tmp_25 = tmp_26;
        } else {
          tmp_25 = this_10;
        }
        tmp_24 = tmp_25;
      } else {
        tmp_24 = '';
      }
      var tmp_28 = tmp_24;
      var tmp_29 = attr(this, raw, 'drm');
      // Inline function 'kotlin.text.orEmpty' call
      var tmp0_elvis_lhs_6 = getOrNull_0(parts, 2);
      var tmp$ret$48 = tmp0_elvis_lhs_6 == null ? '' : tmp0_elvis_lhs_6;
      var tmp_30 = substringBefore(tmp$ret$48, _Char___init__impl__6a9atx(58));
      // Inline function 'kotlin.text.orEmpty' call
      var tmp0_elvis_lhs_7 = getOrNull_0(parts, 4);
      var tmp$ret$49 = tmp0_elvis_lhs_7 == null ? '' : tmp0_elvis_lhs_7;
      var entry = new OperatorEntry(id, tmp_13, tmp_14, tmp_15, tmp_16, tmp_17, logo, epg, epgName, hours_0, tmp_18, tmp_21, tmp_23, tmp_28, tmp_29, tmp_30, tmp$ret$49);
      if (profile === 'shura')
        updates.add_utx5q5_k$(entry);
      else {
        // Inline function 'kotlin.collections.set' call
        entries.put_4fpzoq_k$(id, entry);
      }
    }
    return new OperatorCatalog(profile === 'shura' ? updates : toList_0(entries.get_values_ksazhn_k$()), groups, toList_0(groups.get_keys_wop4xp_k$()), malformed);
  };
  var OperatorPlaylist_instance;
  function OperatorPlaylist_getInstance() {
    return OperatorPlaylist_instance;
  }
  var static_init_called_7;
  function static_init_7() {
    if (static_init_called_7)
      return Unit_instance;
    static_init_called_7 = true;
    PlaylistFormat_BROWSER_instance = new PlaylistFormat('BROWSER', 0);
    PlaylistFormat_ANDROID_instance = new PlaylistFormat('ANDROID', 1);
  }
  var PlaylistFormat_BROWSER_instance;
  var PlaylistFormat_ANDROID_instance;
  function PlaylistFormat(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function PlaylistFailure(code) {
    Exception_init_$Init$_0(code, this);
    captureStack(this, PlaylistFailure);
    this.code_1 = code;
  }
  function PlaylistDirective(kind, name, value) {
    this.kind_1 = kind;
    this.name_1 = name;
    this.value_1 = value;
  }
  protoOf(PlaylistDirective).toString = function () {
    return 'PlaylistDirective(kind=' + this.kind_1 + ', name=' + this.name_1 + ', value=' + this.value_1 + ')';
  };
  protoOf(PlaylistDirective).hashCode = function () {
    var result = getStringHashCode(this.kind_1);
    result = imul(result, 31) + getStringHashCode(this.name_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.value_1) | 0;
    return result;
  };
  protoOf(PlaylistDirective).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof PlaylistDirective))
      return false;
    if (!(this.kind_1 === other.kind_1))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    if (!(this.value_1 === other.value_1))
      return false;
    return true;
  };
  function PlaylistArchive(mode, source, days, correction) {
    correction = correction === VOID ? 0.0 : correction;
    this.mode_1 = mode;
    this.source_1 = source;
    this.days_1 = days;
    this.correction_1 = correction;
  }
  protoOf(PlaylistArchive).toString = function () {
    return 'PlaylistArchive(mode=' + this.mode_1 + ', source=' + this.source_1 + ', days=' + this.days_1 + ', correction=' + this.correction_1 + ')';
  };
  protoOf(PlaylistArchive).hashCode = function () {
    var result = getStringHashCode(this.mode_1);
    result = imul(result, 31) + getStringHashCode(this.source_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.days_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.correction_1) | 0;
    return result;
  };
  protoOf(PlaylistArchive).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof PlaylistArchive))
      return false;
    if (!(this.mode_1 === other.mode_1))
      return false;
    if (!(this.source_1 === other.source_1))
      return false;
    if (!equals(this.days_1, other.days_1))
      return false;
    if (!equals(this.correction_1, other.correction_1))
      return false;
    return true;
  };
  function PlaylistEntry(id, name, url, group, logo, epgId, epgName, movie, shift, epgUrls, archive, directives, generatedTitle, generatedTitleIndex) {
    generatedTitle = generatedTitle === VOID ? false : generatedTitle;
    generatedTitleIndex = generatedTitleIndex === VOID ? 0 : generatedTitleIndex;
    this.id_1 = id;
    this.name_1 = name;
    this.url_1 = url;
    this.group_1 = group;
    this.logo_1 = logo;
    this.epgId_1 = epgId;
    this.epgName_1 = epgName;
    this.movie_1 = movie;
    this.shift_1 = shift;
    this.epgUrls_1 = epgUrls;
    this.archive_1 = archive;
    this.directives_1 = directives;
    this.generatedTitle_1 = generatedTitle;
    this.generatedTitleIndex_1 = generatedTitleIndex;
  }
  protoOf(PlaylistEntry).toString = function () {
    return 'PlaylistEntry(id=' + this.id_1 + ', name=' + this.name_1 + ', url=' + this.url_1 + ', group=' + this.group_1 + ', logo=' + this.logo_1 + ', epgId=' + this.epgId_1 + ', epgName=' + this.epgName_1 + ', movie=' + this.movie_1 + ', shift=' + this.shift_1 + ', epgUrls=' + toString_1(this.epgUrls_1) + ', archive=' + toString_0(this.archive_1) + ', directives=' + toString_1(this.directives_1) + ', generatedTitle=' + this.generatedTitle_1 + ', generatedTitleIndex=' + this.generatedTitleIndex_1 + ')';
  };
  protoOf(PlaylistEntry).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + getStringHashCode(this.name_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.url_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.group_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.logo_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.epgId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.epgName_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.movie_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.shift_1) | 0;
    result = imul(result, 31) + hashCode_0(this.epgUrls_1) | 0;
    result = imul(result, 31) + (this.archive_1 == null ? 0 : this.archive_1.hashCode()) | 0;
    result = imul(result, 31) + hashCode_0(this.directives_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.generatedTitle_1) | 0;
    result = imul(result, 31) + this.generatedTitleIndex_1 | 0;
    return result;
  };
  protoOf(PlaylistEntry).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof PlaylistEntry))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    if (!(this.url_1 === other.url_1))
      return false;
    if (!(this.group_1 === other.group_1))
      return false;
    if (!(this.logo_1 === other.logo_1))
      return false;
    if (!(this.epgId_1 === other.epgId_1))
      return false;
    if (!(this.epgName_1 === other.epgName_1))
      return false;
    if (!(this.movie_1 === other.movie_1))
      return false;
    if (!equals(this.shift_1, other.shift_1))
      return false;
    if (!equals(this.epgUrls_1, other.epgUrls_1))
      return false;
    if (!equals(this.archive_1, other.archive_1))
      return false;
    if (!equals(this.directives_1, other.directives_1))
      return false;
    if (!(this.generatedTitle_1 === other.generatedTitle_1))
      return false;
    if (!(this.generatedTitleIndex_1 === other.generatedTitleIndex_1))
      return false;
    return true;
  };
  function PlaylistResult(entries, epgUrls, warnings, hls, hlsProperties) {
    hls = hls === VOID ? false : hls;
    hlsProperties = hlsProperties === VOID ? emptyList() : hlsProperties;
    this.entries_1 = entries;
    this.epgUrls_1 = epgUrls;
    this.warnings_1 = warnings;
    this.hls_1 = hls;
    this.hlsProperties_1 = hlsProperties;
  }
  protoOf(PlaylistResult).toString = function () {
    return 'PlaylistResult(entries=' + toString_1(this.entries_1) + ', epgUrls=' + toString_1(this.epgUrls_1) + ', warnings=' + toString_1(this.warnings_1) + ', hls=' + this.hls_1 + ', hlsProperties=' + toString_1(this.hlsProperties_1) + ')';
  };
  protoOf(PlaylistResult).hashCode = function () {
    var result = hashCode_0(this.entries_1);
    result = imul(result, 31) + hashCode_0(this.epgUrls_1) | 0;
    result = imul(result, 31) + hashCode_0(this.warnings_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.hls_1) | 0;
    result = imul(result, 31) + hashCode_0(this.hlsProperties_1) | 0;
    return result;
  };
  protoOf(PlaylistResult).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof PlaylistResult))
      return false;
    if (!equals(this.entries_1, other.entries_1))
      return false;
    if (!equals(this.epgUrls_1, other.epgUrls_1))
      return false;
    if (!equals(this.warnings_1, other.warnings_1))
      return false;
    if (!(this.hls_1 === other.hls_1))
      return false;
    if (!equals(this.hlsProperties_1, other.hlsProperties_1))
      return false;
    return true;
  };
  function trim_0($this, value, format) {
    var tmp = CoreText_getInstance();
    var tmp_0;
    if (format.equals(PlaylistFormat_ANDROID_getInstance())) {
      tmp_0 = CoreText$androidSpace$ref(CoreText_getInstance());
    } else {
      tmp_0 = CoreText$space$ref(CoreText_getInstance());
    }
    return tmp.trim_l1e112_k$(value, tmp_0);
  }
  function keyChar($this, c) {
    return (_Char___init__impl__6a9atx(97) <= c ? c <= _Char___init__impl__6a9atx(122) : false) || (_Char___init__impl__6a9atx(65) <= c ? c <= _Char___init__impl__6a9atx(90) : false) || (_Char___init__impl__6a9atx(48) <= c ? c <= _Char___init__impl__6a9atx(57) : false) || c === _Char___init__impl__6a9atx(95) || c === _Char___init__impl__6a9atx(45);
  }
  function archive($this, attrs, defaults, format, fallback, resolve) {
    if (format.equals(PlaylistFormat_BROWSER_getInstance())) {
      var tmp0 = listOf_0([attrs, defaults]);
      var tmp$ret$0;
      $l$block_0: {
        // Inline function 'kotlin.collections.firstNotNullOfOrNull' call
        var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
        while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
          var element = _iterator__ex2g4s.next_20eer_k$();
          var tmp0_0 = Playlist_getInstance().archiveKeys_1;
          var tmp$ret$2;
          $l$block: {
            // Inline function 'kotlin.collections.firstOrNull' call
            var _iterator__ex2g4s_0 = tmp0_0.iterator_jk1svi_k$();
            while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
              var element_0 = _iterator__ex2g4s_0.next_20eer_k$();
              if (element.containsKey_aw81wo_k$(element_0)) {
                tmp$ret$2 = element_0;
                break $l$block;
              }
            }
            tmp$ret$2 = null;
          }
          var tmp0_safe_receiver = tmp$ret$2;
          var tmp;
          if (tmp0_safe_receiver == null) {
            tmp = null;
          } else {
            // Inline function 'kotlin.let' call
            tmp = getValue(element, tmp0_safe_receiver);
          }
          var result = tmp;
          if (!(result == null)) {
            tmp$ret$0 = result;
            break $l$block_0;
          }
        }
        tmp$ret$0 = null;
      }
      var declared = tmp$ret$0;
      var tmp_0;
      if (declared == null) {
        tmp_0 = null;
      } else {
        // Inline function 'kotlin.let' call
        tmp_0 = decimalDays(Playlist_getInstance(), CoreText_getInstance().trim$default_yjecrm_k$(declared));
      }
      var tmp1_elvis_lhs = tmp_0;
      var days = tmp1_elvis_lhs == null ? 0.0 : tmp1_elvis_lhs;
      // Inline function 'kotlin.text.ifEmpty' call
      var this_0 = archive$value(attrs, defaults, 'catchup');
      var tmp_1;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(this_0) === 0) {
        tmp_1 = archive$value(attrs, defaults, 'catchup-type');
      } else {
        tmp_1 = this_0;
      }
      var mode = tmp_1;
      var tmp_2;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(mode) === 0) {
        tmp_2 = days === 0.0;
      } else {
        tmp_2 = false;
      }
      if (tmp_2)
        return null;
      var rawSource = archive$value(attrs, defaults, 'catchup-source');
      var source = CoreText_getInstance().trim$default_yjecrm_k$(rawSource);
      var tmp_3 = CoreText_getInstance();
      // Inline function 'kotlin.text.ifEmpty' call
      var tmp_4;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(mode) === 0) {
        var tmp_5;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(rawSource) === 0) {
          tmp_5 = 'shift';
        } else {
          tmp_5 = 'default';
        }
        tmp_4 = tmp_5;
      } else {
        tmp_4 = mode;
      }
      var tmp$ret$12 = tmp_4;
      // Inline function 'kotlin.text.lowercase' call
      // Inline function 'kotlin.js.asDynamic' call
      var type = tmp_3.trim$default_yjecrm_k$(tmp$ret$12).toLowerCase();
      var tmp_6;
      var tmp_7;
      // Inline function 'kotlin.text.isNotEmpty' call
      if (charSequenceLength(source) > 0) {
        tmp_7 = !(type === 'append');
      } else {
        tmp_7 = false;
      }
      if (tmp_7) {
        tmp_6 = resolve(source);
      } else {
        tmp_6 = source;
      }
      return new PlaylistArchive(type, tmp_6, days, number_0($this, archive$value(attrs, defaults, 'catchup-correction')));
    }
    var all = plus_1(defaults, attrs);
    var tmp0_1 = $this.archiveKeys_1;
    var tmp$ret$19;
    $l$block_1: {
      // Inline function 'kotlin.collections.firstNotNullOfOrNull' call
      var _iterator__ex2g4s_1 = tmp0_1.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
        var element_1 = _iterator__ex2g4s_1.next_20eer_k$();
        var tmp0_safe_receiver_0 = all.get_wei43m_k$(element_1);
        var result_0 = tmp0_safe_receiver_0 == null ? null : toDoubleOrNull(tmp0_safe_receiver_0);
        if (!(result_0 == null)) {
          tmp$ret$19 = result_0;
          break $l$block_1;
        }
      }
      tmp$ret$19 = null;
    }
    var tmp2_safe_receiver = tmp$ret$19;
    var tmp3_elvis_lhs = tmp2_safe_receiver == null ? null : coerceAtLeast_0(tmp2_safe_receiver, 0.0);
    var tmp_8;
    if (tmp3_elvis_lhs == null) {
      var tmp_9;
      var tmp0_2 = $this.archiveKeys_1;
      var tmp$ret$21;
      $l$block_3: {
        // Inline function 'kotlin.collections.any' call
        var tmp_10;
        if (isInterface(tmp0_2, Collection)) {
          tmp_10 = tmp0_2.isEmpty_y1axqb_k$();
        } else {
          tmp_10 = false;
        }
        if (tmp_10) {
          tmp$ret$21 = false;
          break $l$block_3;
        }
        var _iterator__ex2g4s_2 = tmp0_2.iterator_jk1svi_k$();
        while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
          var element_2 = _iterator__ex2g4s_2.next_20eer_k$();
          if (all.containsKey_aw81wo_k$(element_2)) {
            tmp$ret$21 = true;
            break $l$block_3;
          }
        }
        tmp$ret$21 = false;
      }
      if (tmp$ret$21) {
        tmp_9 = 0.0;
      } else {
        // Inline function 'kotlin.takeIf' call
        var tmp_11;
        if (isFinite(fallback) && fallback >= 0) {
          tmp_11 = fallback;
        } else {
          tmp_11 = null;
        }
        var tmp4_elvis_lhs = tmp_11;
        tmp_9 = tmp4_elvis_lhs == null ? 0.0 : tmp4_elvis_lhs;
      }
      tmp_8 = tmp_9;
    } else {
      tmp_8 = tmp3_elvis_lhs;
    }
    var days_0 = tmp_8;
    var tmp5_elvis_lhs = all.get_wei43m_k$('catchup');
    var tmp_12;
    if (tmp5_elvis_lhs == null) {
      // Inline function 'kotlin.text.orEmpty' call
      var tmp0_elvis_lhs = all.get_wei43m_k$('catchup-type');
      tmp_12 = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
    } else {
      tmp_12 = tmp5_elvis_lhs;
    }
    var mode_0 = tmp_12;
    // Inline function 'kotlin.text.orEmpty' call
    var tmp0_elvis_lhs_0 = all.get_wei43m_k$('catchup-source');
    var source_0 = tmp0_elvis_lhs_0 == null ? '' : tmp0_elvis_lhs_0;
    var tmp_13;
    if (equals_0(mode_0, 'none', true)) {
      tmp_13 = true;
    } else {
      var tmp_14;
      var tmp_15;
      if (days_0 > 0) {
        tmp_15 = true;
      } else {
        // Inline function 'kotlin.text.isNotEmpty' call
        tmp_15 = charSequenceLength(source_0) > 0;
      }
      if (tmp_15) {
        tmp_14 = true;
      } else {
        // Inline function 'kotlin.text.isNotEmpty' call
        tmp_14 = charSequenceLength(mode_0) > 0;
      }
      tmp_13 = !tmp_14;
    }
    if (tmp_13)
      return null;
    // Inline function 'kotlin.text.ifBlank' call
    var tmp_16;
    if (isBlank(mode_0)) {
      tmp_16 = 'default';
    } else {
      tmp_16 = mode_0;
    }
    var tmp$ret$29 = tmp_16;
    return new PlaylistArchive(tmp$ret$29, source_0, days_0);
  }
  function decimalDays($this, value) {
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(value) === 0)
      return 0.0;
    var dot = indexOf_2(value, _Char___init__impl__6a9atx(46));
    var tmp;
    var tmp$ret$1;
    $l$block: {
      // Inline function 'kotlin.text.any' call
      var inductionVariable = 0;
      while (inductionVariable < charSequenceLength(value)) {
        var element = charSequenceGet(value, inductionVariable);
        inductionVariable = inductionVariable + 1 | 0;
        if (!(_Char___init__impl__6a9atx(48) <= element ? element <= _Char___init__impl__6a9atx(57) : false) && !(element === _Char___init__impl__6a9atx(46))) {
          tmp$ret$1 = true;
          break $l$block;
        }
      }
      tmp$ret$1 = false;
    }
    if (tmp$ret$1) {
      tmp = true;
    } else {
      tmp = (dot >= 0 && (dot === get_lastIndex_1(value) || indexOf_2(value, _Char___init__impl__6a9atx(46), dot + 1 | 0) >= 0));
    }
    if (tmp)
      return 0.0;
    var tmp0_safe_receiver = toDoubleOrNull(value);
    var tmp_0;
    if (tmp0_safe_receiver == null) {
      tmp_0 = null;
    } else {
      // Inline function 'kotlin.takeIf' call
      var tmp_1;
      if (isFinite(tmp0_safe_receiver)) {
        tmp_1 = tmp0_safe_receiver;
      } else {
        tmp_1 = null;
      }
      tmp_0 = tmp_1;
    }
    var tmp1_safe_receiver = tmp_0;
    var tmp2_elvis_lhs = tmp1_safe_receiver == null ? null : coerceAtMost_0(tmp1_safe_receiver, 30.0);
    return tmp2_elvis_lhs == null ? 0.0 : tmp2_elvis_lhs;
  }
  function number_0($this, value) {
    // Inline function 'kotlin.let' call
    var it = CoreNumber_instance.javascript_5uxq0d_k$(value);
    return isNaN_0(it) || it === 0.0 ? 0.0 : it;
  }
  function archive$value($attrs, $defaults, key) {
    var tmp0_elvis_lhs = $attrs.get_wei43m_k$(key);
    var tmp;
    if (tmp0_elvis_lhs == null) {
      // Inline function 'kotlin.text.orEmpty' call
      var tmp0_elvis_lhs_0 = $defaults.get_wei43m_k$(key);
      tmp = tmp0_elvis_lhs_0 == null ? '' : tmp0_elvis_lhs_0;
    } else {
      tmp = tmp0_elvis_lhs;
    }
    return tmp;
  }
  function Playlist$read$lambda(it) {
    return it;
  }
  function Playlist$read$lambda_0(it) {
    return '';
  }
  function Playlist$read$lambda_1(it) {
    return Unit_instance;
  }
  function Playlist$read$lambda_2(it) {
    return Unit_instance;
  }
  function read$feeds($resolve, $format, epgUrls, input, target) {
    target = target === VOID ? null : target;
    var _iterator__ex2g4s = split_0(input, charArrayOf([_Char___init__impl__6a9atx(44)])).iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var value = _iterator__ex2g4s.next_20eer_k$();
      var url = $resolve(trim_0(Playlist_getInstance(), value, $format));
      // Inline function 'kotlin.text.isNotEmpty' call
      if (charSequenceLength(url) > 0) {
        epgUrls.add_utx5q5_k$(url);
        if (target == null)
          null;
        else
          target.add_utx5q5_k$(url);
      }
    }
  }
  function read$directive(directives, $onDirective, kind, key, value) {
    key = key === VOID ? '' : key;
    value = value === VOID ? '' : value;
    var entry = new PlaylistDirective(kind, key, value);
    directives._v.add_utx5q5_k$(entry);
    $onDirective(entry);
  }
  function read$reset(attrs, name, duration, pending, invalid, vod, directives, browser, $onDirective) {
    attrs._v = emptyMap();
    name._v = '';
    duration._v = -1.0;
    pending._v = false;
    invalid._v = false;
    vod._v = false;
    // Inline function 'kotlin.collections.mutableListOf' call
    directives._v = ArrayList_init_$Create$();
    if (!browser)
      $onDirective(new PlaylistDirective('reset', '', ''));
  }
  function read$attr(attrs, defaults, key) {
    var tmp0_elvis_lhs = attrs._v.get_wei43m_k$(key);
    var tmp;
    if (tmp0_elvis_lhs == null) {
      // Inline function 'kotlin.text.orEmpty' call
      var tmp0_elvis_lhs_0 = defaults._v.get_wei43m_k$(key);
      tmp = tmp0_elvis_lhs_0 == null ? '' : tmp0_elvis_lhs_0;
    } else {
      tmp = tmp0_elvis_lhs;
    }
    return tmp;
  }
  function Playlist() {
    Playlist_instance = this;
    this.archiveKeys_1 = listOf_0(['catchup-days', 'timeshift', 'tvg-rec']);
  }
  protoOf(Playlist).attributes_7gt55c_k$ = function (value, format) {
    // Inline function 'kotlin.collections.linkedMapOf' call
    var result = LinkedHashMap_init_$Create$();
    var tmp;
    if (format.equals(PlaylistFormat_ANDROID_getInstance())) {
      tmp = CoreText$asciiSpace$ref(CoreText_getInstance());
    } else {
      tmp = CoreText$space$ref(CoreText_getInstance());
    }
    var whitespace = tmp;
    var at = 0;
    $l$loop_1: while (at < value.length) {
      if (!keyChar(this, charCodeAt(value, at))) {
        at = at + 1 | 0;
        continue $l$loop_1;
      }
      var start = at;
      while (at < value.length && keyChar(this, charCodeAt(value, at))) {
        at = at + 1 | 0;
      }
      // Inline function 'kotlin.text.lowercase' call
      // Inline function 'kotlin.js.asDynamic' call
      var key = substring(value, start, at).toLowerCase();
      while (at < value.length && whitespace(new Char(charCodeAt(value, at)))) {
        at = at + 1 | 0;
      }
      var tmp_0 = getOrNull_1(value, at);
      if (!equals(tmp_0 == null ? null : new Char(tmp_0), new Char(_Char___init__impl__6a9atx(61))))
        continue $l$loop_1;
      at = at + 1 | 0;
      while (at < value.length && whitespace(new Char(charCodeAt(value, at)))) {
        at = at + 1 | 0;
      }
      if (at === value.length)
        break $l$loop_1;
      var quote = charCodeAt(value, at);
      var close = quote === _Char___init__impl__6a9atx(34) || quote === _Char___init__impl__6a9atx(39) ? indexOf_2(value, quote, at + 1 | 0) : -1;
      if (close >= 0) {
        // Inline function 'kotlin.collections.set' call
        var value_0 = substring(value, at + 1 | 0, close);
        result.put_4fpzoq_k$(key, value_0);
        at = close + 1 | 0;
      } else {
        var from = at;
        while (at < value.length && !whitespace(new Char(charCodeAt(value, at)))) {
          at = at + 1 | 0;
        }
        // Inline function 'kotlin.collections.set' call
        var value_1 = substring(value, from, at);
        result.put_4fpzoq_k$(key, value_1);
      }
    }
    return result;
  };
  protoOf(Playlist).titleComma_xhrjer_k$ = function (value) {
    var quote = null;
    // Inline function 'kotlin.text.forEachIndexed' call
    var index = 0;
    var inductionVariable = 0;
    while (inductionVariable < charSequenceLength(value)) {
      var item = charSequenceGet(value, inductionVariable);
      inductionVariable = inductionVariable + 1 | 0;
      var _unary__edvuaz = index;
      index = _unary__edvuaz + 1 | 0;
      var tmp = quote;
      if (equals(tmp == null ? null : new Char(tmp), new Char(item)))
        quote = null;
      else {
        var tmp_0;
        var tmp_1 = quote;
        if ((tmp_1 == null ? null : new Char(tmp_1)) == null) {
          tmp_0 = contains_2('"\'', item);
        } else {
          tmp_0 = false;
        }
        if (tmp_0)
          quote = item;
        else {
          var tmp_2;
          var tmp_3 = quote;
          if ((tmp_3 == null ? null : new Char(tmp_3)) == null) {
            tmp_2 = item === _Char___init__impl__6a9atx(44);
          } else {
            tmp_2 = false;
          }
          if (tmp_2)
            return _unary__edvuaz;
        }
      }
    }
    return -1;
  };
  protoOf(Playlist).read_8novqu_k$ = function (text, format, sourceId, resolve, identifier, component, filename, epgUrl, fallbackDays, onEntry, onDirective) {
    if (text.length > 33554432)
      throw new PlaylistFailure('SIZE');
    var browser = format.equals(PlaylistFormat_BROWSER_getInstance());
    // Inline function 'kotlin.collections.map' call
    var this_0 = lines(removePrefix(text, '\uFEFF'));
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = trim_0(Playlist_getInstance(), item, format);
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    var lines_0 = destination;
    var tmp;
    if (!browser) {
      var tmp$ret$3;
      $l$block_0: {
        // Inline function 'kotlin.collections.any' call
        var tmp_0;
        if (isInterface(lines_0, Collection)) {
          tmp_0 = lines_0.isEmpty_y1axqb_k$();
        } else {
          tmp_0 = false;
        }
        if (tmp_0) {
          tmp$ret$3 = false;
          break $l$block_0;
        }
        var _iterator__ex2g4s_0 = lines_0.iterator_jk1svi_k$();
        while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
          var element = _iterator__ex2g4s_0.next_20eer_k$();
          if (startsWith(element, '#EXT-X-STREAM-INF:') || startsWith(element, '#EXT-X-TARGETDURATION:')) {
            tmp$ret$3 = true;
            break $l$block_0;
          }
        }
        tmp$ret$3 = false;
      }
      tmp = tmp$ret$3;
    } else {
      tmp = false;
    }
    if (tmp) {
      var tmp_1 = emptyList();
      var tmp_2 = emptyList();
      var tmp_3 = emptyList();
      // Inline function 'kotlin.collections.filter' call
      // Inline function 'kotlin.collections.filterTo' call
      var destination_0 = ArrayList_init_$Create$();
      var _iterator__ex2g4s_1 = lines_0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
        var element_0 = _iterator__ex2g4s_1.next_20eer_k$();
        if (startsWith(element_0, '#KODIPROP:', true)) {
          destination_0.add_utx5q5_k$(element_0);
        }
      }
      // Inline function 'kotlin.collections.map' call
      // Inline function 'kotlin.collections.mapTo' call
      var destination_1 = ArrayList_init_$Create$_0(collectionSizeOrDefault(destination_0, 10));
      var _iterator__ex2g4s_2 = destination_0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
        var item_0 = _iterator__ex2g4s_2.next_20eer_k$();
        var property = substringAfter(item_0, _Char___init__impl__6a9atx(58));
        var tmp$ret$10 = new PlaylistDirective('property', substringBefore(property, _Char___init__impl__6a9atx(61)), substringAfter(property, _Char___init__impl__6a9atx(61), ''));
        destination_1.add_utx5q5_k$(tmp$ret$10);
      }
      return new PlaylistResult(tmp_1, tmp_2, tmp_3, true, destination_1);
    }
    // Inline function 'kotlin.collections.mutableListOf' call
    var entries = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.mutableSetOf' call
    var seen = LinkedHashSet_init_$Create$();
    // Inline function 'kotlin.collections.mutableMapOf' call
    var counts = LinkedHashMap_init_$Create$();
    // Inline function 'kotlin.collections.linkedSetOf' call
    var epgUrls = LinkedHashSet_init_$Create$();
    // Inline function 'kotlin.collections.linkedSetOf' call
    var defaultEpg = LinkedHashSet_init_$Create$();
    // Inline function 'kotlin.collections.mutableListOf' call
    var warnings = ArrayList_init_$Create$();
    var tmp_4;
    if (!browser) {
      // Inline function 'kotlin.text.isNotBlank' call
      tmp_4 = !isBlank(epgUrl);
    } else {
      tmp_4 = false;
    }
    if (tmp_4) {
      // Inline function 'kotlin.takeIf' call
      var this_1 = resolve(epgUrl);
      var tmp_5;
      // Inline function 'kotlin.text.isNotEmpty' call
      if (charSequenceLength(this_1) > 0) {
        tmp_5 = this_1;
      } else {
        tmp_5 = null;
      }
      var tmp0_safe_receiver = tmp_5;
      if (tmp0_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        epgUrls.add_utx5q5_k$(tmp0_safe_receiver);
      }
    }
    var defaults = {_v: emptyMap()};
    var attrs = {_v: emptyMap()};
    var name = {_v: ''};
    var duration = {_v: -1.0};
    var group = '';
    var pending = {_v: false};
    var invalid = {_v: false};
    var vod = {_v: false};
    var header = false;
    // Inline function 'kotlin.collections.mutableListOf' call
    var directives = {_v: ArrayList_init_$Create$()};
    var at = 0;
    $l$loop_3: while (at < lines_0.get_size_woubt6_k$()) {
      var _unary__edvuaz = at;
      at = _unary__edvuaz + 1 | 0;
      var line = lines_0.get_c1px32_k$(_unary__edvuaz);
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(line) === 0)
        continue $l$loop_3;
      if (line.length > 1048576)
        throw new PlaylistFailure('LINE_SIZE');
      if (browser && !header) {
        if (!startsWith(line, '#EXTM3U', true) || (line.length > 7 && !CoreText_getInstance().space_3ylfpz_k$(charCodeAt(line, 7))))
          throw new PlaylistFailure('FORMAT');
        defaults._v = this.attributes_7gt55c_k$(line, format);
        // Inline function 'kotlin.text.orEmpty' call
        var tmp0_elvis_lhs = defaults._v.get_wei43m_k$('x-tvg-url');
        var tmp$ret$25 = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
        read$feeds(resolve, format, epgUrls, tmp$ret$25, defaultEpg);
        // Inline function 'kotlin.text.orEmpty' call
        var tmp0_elvis_lhs_0 = defaults._v.get_wei43m_k$('url-tvg');
        var tmp$ret$26 = tmp0_elvis_lhs_0 == null ? '' : tmp0_elvis_lhs_0;
        read$feeds(resolve, format, epgUrls, tmp$ret$26, defaultEpg);
        // Inline function 'kotlin.text.orEmpty' call
        var tmp0_elvis_lhs_1 = defaults._v.get_wei43m_k$('tvg-url');
        // Inline function 'kotlin.text.ifEmpty' call
        var this_2 = tmp0_elvis_lhs_1 == null ? '' : tmp0_elvis_lhs_1;
        var tmp_6;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_2) === 0) {
          // Inline function 'kotlin.text.orEmpty' call
          var tmp0_elvis_lhs_2 = defaults._v.get_wei43m_k$('foss-tvg');
          tmp_6 = tmp0_elvis_lhs_2 == null ? '' : tmp0_elvis_lhs_2;
        } else {
          tmp_6 = this_2;
        }
        var tmp$ret$28 = tmp_6;
        read$feeds(resolve, format, epgUrls, tmp$ret$28, defaultEpg);
        header = true;
        continue $l$loop_3;
      }
      if (!browser && startsWith(line, '#EXTM3U', true)) {
        defaults._v = this.attributes_7gt55c_k$(line, format);
        // Inline function 'kotlin.text.orEmpty' call
        var tmp0_elvis_lhs_3 = defaults._v.get_wei43m_k$('url-tvg');
        var tmp$ret$32 = tmp0_elvis_lhs_3 == null ? '' : tmp0_elvis_lhs_3;
        read$feeds(resolve, format, epgUrls, tmp$ret$32);
        // Inline function 'kotlin.text.orEmpty' call
        var tmp0_elvis_lhs_4 = defaults._v.get_wei43m_k$('x-tvg-url');
        var tmp$ret$33 = tmp0_elvis_lhs_4 == null ? '' : tmp0_elvis_lhs_4;
        read$feeds(resolve, format, epgUrls, tmp$ret$33);
      } else if (startsWith(line, '#EXTINF:', true)) {
        read$reset(attrs, name, duration, pending, invalid, vod, directives, browser, onDirective);
        var info = substringAfter(line, _Char___init__impl__6a9atx(58));
        if (!browser)
          $l$loop_1: while (true) {
            var tmp_7;
            if (this.titleComma_xhrjer_k$(info) < 0 && at < lines_0.get_size_woubt6_k$()) {
              var tmp0 = listOf_0(['tvg-', 'group-title', 'catchup']);
              var tmp$ret$34;
              $l$block_2: {
                // Inline function 'kotlin.collections.any' call
                var tmp_8;
                if (isInterface(tmp0, Collection)) {
                  tmp_8 = tmp0.isEmpty_y1axqb_k$();
                } else {
                  tmp_8 = false;
                }
                if (tmp_8) {
                  tmp$ret$34 = false;
                  break $l$block_2;
                }
                var _iterator__ex2g4s_3 = tmp0.iterator_jk1svi_k$();
                while (_iterator__ex2g4s_3.hasNext_bitz1p_k$()) {
                  var element_1 = _iterator__ex2g4s_3.next_20eer_k$();
                  if (startsWith(lines_0.get_c1px32_k$(at), element_1, true)) {
                    tmp$ret$34 = true;
                    break $l$block_2;
                  }
                }
                tmp$ret$34 = false;
              }
              tmp_7 = tmp$ret$34;
            } else {
              tmp_7 = false;
            }
            if (!tmp_7) {
              break $l$loop_1;
            }
            var tmp_9 = info;
            var _unary__edvuaz_0 = at;
            at = _unary__edvuaz_0 + 1 | 0;
            info = tmp_9 + (' ' + lines_0.get_c1px32_k$(_unary__edvuaz_0));
          }
        var comma = this.titleComma_xhrjer_k$(info);
        if (comma < 0) {
          invalid._v = true;
          if (browser) {
            warnings.add_utx5q5_k$('Ignored malformed EXTINF at line ' + at);
          }
        } else {
          attrs._v = this.attributes_7gt55c_k$(substring(info, 0, comma), format);
          name._v = trim_0(this, substring_0(info, comma + 1 | 0), format);
          var tmp1_elvis_lhs = toDoubleOrNull(substringBefore(substringBefore(info, _Char___init__impl__6a9atx(32)), _Char___init__impl__6a9atx(44)));
          duration._v = tmp1_elvis_lhs == null ? -1.0 : tmp1_elvis_lhs;
          pending._v = true;
        }
      } else if (startsWith(line, '#EXTGRP:', true)) {
        var value = trim_0(this, substringAfter(line, _Char___init__impl__6a9atx(58)), format);
        if (!browser)
          group = value;
        else {
          var tmp_10;
          if (pending._v) {
            // Inline function 'kotlin.text.isNullOrEmpty' call
            var this_3 = attrs._v.get_wei43m_k$('group-title');
            tmp_10 = this_3 == null || charSequenceLength(this_3) === 0;
          } else {
            tmp_10 = false;
          }
          if (tmp_10) {
            attrs._v = plus_2(attrs._v, to('group-title', value));
          }
        }
      } else if (browser && equals_0(line, '#EXT-X-PLAYLIST-TYPE:VOD', true) && pending._v) {
        vod._v = true;
      } else if (!browser && startsWith(line, '#EXTVLCOPT:', true)) {
        var option = substringAfter(line, _Char___init__impl__6a9atx(58));
        // Inline function 'kotlin.text.lowercase' call
        // Inline function 'kotlin.js.asDynamic' call
        var key;
        switch (substringBefore(option, _Char___init__impl__6a9atx(61)).toLowerCase()) {
          case 'http-user-agent':
            key = 'User-Agent';
            break;
          case 'http-referrer':
          case 'http-referer':
            key = 'Referer';
            break;
          case 'http-origin':
            key = 'Origin';
            break;
          default:
            key = null;
            break;
        }
        if (!(key == null)) {
          read$directive(directives, onDirective, 'header', key, substringAfter(option, _Char___init__impl__6a9atx(61), ''));
        }
      } else if (!browser && startsWith(line, '#KODIPROP:', true)) {
        var property_0 = substringAfter(line, _Char___init__impl__6a9atx(58));
        var key_0 = trim_0(this, substringBefore(property_0, _Char___init__impl__6a9atx(61)), format);
        var value_0 = substringAfter(property_0, _Char___init__impl__6a9atx(61), '');
        if (equals_0(key_0, 'inputstream.adaptive.stream_headers', true)) {
          read$directive(directives, onDirective, 'query', '', value_0);
        }
        read$directive(directives, onDirective, 'property', key_0, value_0);
      } else if (!browser && startsWith(line, '#EXTHTTP:', true)) {
        read$directive(directives, onDirective, 'json', '', substringAfter(line, _Char___init__impl__6a9atx(58)));
      } else if (!startsWith_0(line, _Char___init__impl__6a9atx(35))) {
        var raw = browser ? line : trim_0(this, substringBefore(line, _Char___init__impl__6a9atx(124)), format);
        var eligible = browser ? pending._v : !invalid._v && (pending._v || startsWith(raw, 'http://', true) || startsWith(raw, 'https://', true));
        var url = eligible ? resolve(raw) : '';
        var tmp_11;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(url) === 0) {
          tmp_11 = true;
        } else {
          tmp_11 = (!browser && (contains_2(raw, _Char___init__impl__6a9atx(60)) || contains_2(raw, _Char___init__impl__6a9atx(62))));
        }
        if (tmp_11) {
          if (browser) {
            warnings.add_utx5q5_k$('Ignored unsupported or incomplete stream at line ' + at);
          }
          read$reset(attrs, name, duration, pending, invalid, vod, directives, browser, onDirective);
          continue $l$loop_3;
        }
        var tmp_12;
        if (browser) {
          tmp_12 = trim_0(this, read$attr(attrs, defaults, 'tvg-id'), format);
        } else {
          // Inline function 'kotlin.text.orEmpty' call
          var tmp0_elvis_lhs_5 = attrs._v.get_wei43m_k$('tvg-id');
          tmp_12 = tmp0_elvis_lhs_5 == null ? '' : tmp0_elvis_lhs_5;
        }
        var id = tmp_12;
        var tmp_13;
        if (browser) {
          tmp_13 = trim_0(this, read$attr(attrs, defaults, 'tvg-name'), format);
        } else {
          // Inline function 'kotlin.text.orEmpty' call
          var tmp0_elvis_lhs_6 = attrs._v.get_wei43m_k$('tvg-name');
          tmp_13 = tmp0_elvis_lhs_6 == null ? '' : tmp0_elvis_lhs_6;
        }
        var tvgName = tmp_13;
        var tmp_14;
        if (browser) {
          // Inline function 'kotlin.text.ifEmpty' call
          var this_4 = name._v;
          var tmp_15;
          // Inline function 'kotlin.text.isEmpty' call
          if (charSequenceLength(this_4) === 0) {
            // Inline function 'kotlin.text.orEmpty' call
            var tmp0_elvis_lhs_7 = attrs._v.get_wei43m_k$('tvg-name');
            tmp_15 = tmp0_elvis_lhs_7 == null ? '' : tmp0_elvis_lhs_7;
          } else {
            tmp_15 = this_4;
          }
          // Inline function 'kotlin.text.ifEmpty' call
          var this_5 = tmp_15;
          var tmp_16;
          // Inline function 'kotlin.text.isEmpty' call
          if (charSequenceLength(this_5) === 0) {
            tmp_16 = 'Channel';
          } else {
            tmp_16 = this_5;
          }
          tmp_14 = tmp_16;
        } else {
          // Inline function 'kotlin.text.ifBlank' call
          var this_6 = name._v;
          var tmp_17;
          if (isBlank(this_6)) {
            tmp_17 = tvgName;
          } else {
            tmp_17 = this_6;
          }
          // Inline function 'kotlin.text.ifBlank' call
          var this_7 = tmp_17;
          var tmp_18;
          if (isBlank(this_7)) {
            tmp_18 = id;
          } else {
            tmp_18 = this_7;
          }
          // Inline function 'kotlin.text.ifBlank' call
          var this_8 = tmp_18;
          var tmp_19;
          if (isBlank(this_8)) {
            tmp_19 = filename(url);
          } else {
            tmp_19 = this_8;
          }
          // Inline function 'kotlin.text.ifBlank' call
          var this_9 = tmp_19;
          var tmp_20;
          if (isBlank(this_9)) {
            tmp_20 = 'Stream ' + (entries.get_size_woubt6_k$() + 1 | 0);
          } else {
            tmp_20 = this_9;
          }
          tmp_14 = tmp_20;
        }
        var title = tmp_14;
        var tmp_21;
        if (browser) {
          // Inline function 'kotlin.text.ifEmpty' call
          var this_10 = read$attr(attrs, defaults, 'group-title');
          var tmp_22;
          // Inline function 'kotlin.text.isEmpty' call
          if (charSequenceLength(this_10) === 0) {
            tmp_22 = 'Other';
          } else {
            tmp_22 = this_10;
          }
          tmp_21 = tmp_22;
        } else {
          // Inline function 'kotlin.text.orEmpty' call
          var tmp0_elvis_lhs_8 = attrs._v.get_wei43m_k$('group-title');
          // Inline function 'kotlin.text.ifBlank' call
          var this_11 = tmp0_elvis_lhs_8 == null ? '' : tmp0_elvis_lhs_8;
          var tmp_23;
          if (isBlank(this_11)) {
            tmp_23 = group;
          } else {
            tmp_23 = this_11;
          }
          tmp_21 = tmp_23;
        }
        var entryGroup = tmp_21;
        var tmp_24;
        if (!browser) {
          // Inline function 'kotlin.text.isNotBlank' call
          tmp_24 = !isBlank(entryGroup);
        } else {
          tmp_24 = false;
        }
        if (tmp_24)
          group = entryGroup;
        var tmp_25;
        if (browser) {
          tmp_25 = id + '\n' + url;
        } else {
          // Inline function 'kotlin.text.ifBlank' call
          var tmp_26;
          if (isBlank(id)) {
            tmp_26 = url;
          } else {
            tmp_26 = id;
          }
          var tmp$ret$64 = tmp_26;
          tmp_25 = identifier(listOf_0([sourceId, tmp$ret$64, title]));
        }
        var key_1 = tmp_25;
        if (browser && seen.contains_aljjnj_k$(key_1)) {
          read$reset(attrs, name, duration, pending, invalid, vod, directives, browser, onDirective);
          continue $l$loop_3;
        }
        // Inline function 'kotlin.collections.linkedSetOf' call
        var itemEpg = LinkedHashSet_init_$Create$();
        if (browser) {
          // Inline function 'kotlin.text.orEmpty' call
          var tmp0_elvis_lhs_9 = attrs._v.get_wei43m_k$('url-tvg');
          var tmp$ret$67 = tmp0_elvis_lhs_9 == null ? '' : tmp0_elvis_lhs_9;
          read$feeds(resolve, format, epgUrls, tmp$ret$67, itemEpg);
          // Inline function 'kotlin.text.orEmpty' call
          var tmp0_elvis_lhs_10 = attrs._v.get_wei43m_k$('tvg-source');
          var tmp$ret$68 = tmp0_elvis_lhs_10 == null ? '' : tmp0_elvis_lhs_10;
          read$feeds(resolve, format, epgUrls, tmp$ret$68, itemEpg);
          itemEpg.addAll_h3ej1q_k$(defaultEpg);
        }
        if (!browser && contains_2(line, _Char___init__impl__6a9atx(124))) {
          read$directive(directives, onDirective, 'query', '', substringAfter(line, _Char___init__impl__6a9atx(124)));
        }
        var tmp_27 = browser ? '' : key_1;
        var tmp_28;
        if (browser) {
          tmp_28 = read$attr(attrs, defaults, 'tvg-logo');
        } else {
          // Inline function 'kotlin.text.orEmpty' call
          var tmp0_elvis_lhs_11 = attrs._v.get_wei43m_k$('tvg-logo');
          tmp_28 = tmp0_elvis_lhs_11 == null ? '' : tmp0_elvis_lhs_11;
        }
        var tmp_29 = resolve(tmp_28);
        var tmp_30;
        if (browser) {
          var tmp_31;
          var tmp_32;
          if (vod._v || equals_0(attrs._v.get_wei43m_k$('media'), 'true', true) || attrs._v.get_wei43m_k$('media') === '1') {
            tmp_32 = true;
          } else {
            // Inline function 'kotlin.text.isNullOrEmpty' call
            var this_12 = attrs._v.get_wei43m_k$('media-dir');
            tmp_32 = !(this_12 == null || charSequenceLength(this_12) === 0);
          }
          if (tmp_32) {
            tmp_31 = true;
          } else {
            // Inline function 'kotlin.text.isNullOrEmpty' call
            var this_13 = attrs._v.get_wei43m_k$('media-size');
            tmp_31 = !(this_13 == null || charSequenceLength(this_13) === 0);
          }
          tmp_30 = tmp_31;
        } else {
          tmp_30 = pending._v && duration._v > 0 || equals_0(attrs._v.get_wei43m_k$('type'), 'movie', true);
        }
        var entry = new PlaylistEntry(tmp_27, title, url, entryGroup, tmp_29, id, tvgName, tmp_30, browser ? number_0(this, read$attr(attrs, defaults, 'tvg-shift')) : 0.0, toList_0(itemEpg), archive(this, attrs._v, defaults._v, format, fallbackDays, resolve), toList_0(directives._v), !browser && isBlank(name._v) && isBlank(tvgName) && isBlank(id) && isBlank(filename(url)), entries.get_size_woubt6_k$() + 1 | 0);
        onEntry(entry);
        if (seen.add_utx5q5_k$(key_1)) {
          entries.add_utx5q5_k$(entry);
          var tmp3_elvis_lhs = counts.get_wei43m_k$(id);
          // Inline function 'kotlin.collections.set' call
          var value_1 = (tmp3_elvis_lhs == null ? 0 : tmp3_elvis_lhs) + 1 | 0;
          counts.put_4fpzoq_k$(id, value_1);
          if (entries.get_size_woubt6_k$() > 100000)
            throw new PlaylistFailure('COUNT');
        }
        read$reset(attrs, name, duration, pending, invalid, vod, directives, browser, onDirective);
      }
    }
    if (browser && !header)
      throw new PlaylistFailure('EMPTY');
    if (!browser && entries.isEmpty_y1axqb_k$())
      throw new PlaylistFailure('NO_ENTRIES');
    if (browser) {
      var _iterator__ex2g4s_4 = entries.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_4.hasNext_bitz1p_k$()) {
        var entry_0 = _iterator__ex2g4s_4.next_20eer_k$();
        var tmp_33 = entry_0;
        var tmp_34 = sourceId + ':m3u:';
        var tmp_35;
        // Inline function 'kotlin.text.isEmpty' call
        var this_14 = entry_0.epgId_1;
        if (charSequenceLength(this_14) === 0) {
          tmp_35 = 'url:' + identifier(listOf(entry_0.url_1));
        } else {
          tmp_35 = 'tvg:' + component(entry_0.epgId_1) + (getValue(counts, entry_0.epgId_1) > 1 ? ':' + identifier(listOf(entry_0.url_1)) : '');
        }
        tmp_33.id_1 = tmp_34 + tmp_35;
      }
    }
    return new PlaylistResult(entries, toList_0(epgUrls), warnings);
  };
  protoOf(Playlist).read$default_8tkxrb_k$ = function (text, format, sourceId, resolve, identifier, component, filename, epgUrl, fallbackDays, onEntry, onDirective, $super) {
    var tmp;
    if (component === VOID) {
      tmp = Playlist$read$lambda;
    } else {
      tmp = component;
    }
    component = tmp;
    var tmp_0;
    if (filename === VOID) {
      tmp_0 = Playlist$read$lambda_0;
    } else {
      tmp_0 = filename;
    }
    filename = tmp_0;
    epgUrl = epgUrl === VOID ? '' : epgUrl;
    fallbackDays = fallbackDays === VOID ? 0.0 : fallbackDays;
    var tmp_1;
    if (onEntry === VOID) {
      tmp_1 = Playlist$read$lambda_1;
    } else {
      tmp_1 = onEntry;
    }
    onEntry = tmp_1;
    var tmp_2;
    if (onDirective === VOID) {
      tmp_2 = Playlist$read$lambda_2;
    } else {
      tmp_2 = onDirective;
    }
    onDirective = tmp_2;
    return $super === VOID ? this.read_8novqu_k$(text, format, sourceId, resolve, identifier, component, filename, epgUrl, fallbackDays, onEntry, onDirective) : $super.read_8novqu_k$.call(this, text, format, sourceId, resolve, identifier, component, filename, epgUrl, fallbackDays, onEntry, onDirective);
  };
  var Playlist_instance;
  function Playlist_getInstance() {
    if (Playlist_instance == null)
      new Playlist();
    return Playlist_instance;
  }
  function PlaylistFormat_BROWSER_getInstance() {
    static_init_7();
    return PlaylistFormat_BROWSER_instance;
  }
  function PlaylistFormat_ANDROID_getInstance() {
    static_init_7();
    return PlaylistFormat_ANDROID_instance;
  }
  var static_init_called_8;
  function static_init_8() {
    if (static_init_called_8)
      return Unit_instance;
    static_init_called_8 = true;
    ProviderPlaylistFormat_GENERIC_instance = new ProviderPlaylistFormat('GENERIC', 0);
    ProviderPlaylistFormat_M3U_instance = new ProviderPlaylistFormat('M3U', 1);
  }
  var ProviderPlaylistFormat_GENERIC_instance;
  var ProviderPlaylistFormat_M3U_instance;
  function ProviderPlaylistFormat(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function ProviderPlaylistEntry(id, name, url, group, category, logo, epgId, epgName, archiveHours, archiveMode, archiveSource, shift, raw, titleHashInput, generatedName) {
    this.id_1 = id;
    this.name_1 = name;
    this.url_1 = url;
    this.group_1 = group;
    this.category_1 = category;
    this.logo_1 = logo;
    this.epgId_1 = epgId;
    this.epgName_1 = epgName;
    this.archiveHours_1 = archiveHours;
    this.archiveMode_1 = archiveMode;
    this.archiveSource_1 = archiveSource;
    this.shift_1 = shift;
    this.raw_1 = raw;
    this.titleHashInput_1 = titleHashInput;
    this.generatedName_1 = generatedName;
  }
  protoOf(ProviderPlaylistEntry).toString = function () {
    return 'ProviderPlaylistEntry(id=' + this.id_1 + ', name=' + this.name_1 + ', url=' + this.url_1 + ', group=' + this.group_1 + ', category=' + this.category_1 + ', logo=' + this.logo_1 + ', epgId=' + this.epgId_1 + ', epgName=' + this.epgName_1 + ', archiveHours=' + this.archiveHours_1 + ', archiveMode=' + this.archiveMode_1 + ', archiveSource=' + this.archiveSource_1 + ', shift=' + this.shift_1 + ', raw=' + this.raw_1 + ', titleHashInput=' + this.titleHashInput_1 + ', generatedName=' + this.generatedName_1 + ')';
  };
  protoOf(ProviderPlaylistEntry).hashCode = function () {
    var result = getNumberHashCode(this.id_1);
    result = imul(result, 31) + getStringHashCode(this.name_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.url_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.group_1) | 0;
    result = imul(result, 31) + this.category_1 | 0;
    result = imul(result, 31) + getStringHashCode(this.logo_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.epgId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.epgName_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.archiveHours_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.archiveMode_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.archiveSource_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.shift_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.raw_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.titleHashInput_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.generatedName_1) | 0;
    return result;
  };
  protoOf(ProviderPlaylistEntry).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof ProviderPlaylistEntry))
      return false;
    if (!equals(this.id_1, other.id_1))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    if (!(this.url_1 === other.url_1))
      return false;
    if (!(this.group_1 === other.group_1))
      return false;
    if (!(this.category_1 === other.category_1))
      return false;
    if (!(this.logo_1 === other.logo_1))
      return false;
    if (!(this.epgId_1 === other.epgId_1))
      return false;
    if (!(this.epgName_1 === other.epgName_1))
      return false;
    if (!equals(this.archiveHours_1, other.archiveHours_1))
      return false;
    if (!(this.archiveMode_1 === other.archiveMode_1))
      return false;
    if (!(this.archiveSource_1 === other.archiveSource_1))
      return false;
    if (!equals(this.shift_1, other.shift_1))
      return false;
    if (!(this.raw_1 === other.raw_1))
      return false;
    if (!(this.titleHashInput_1 === other.titleHashInput_1))
      return false;
    if (!(this.generatedName_1 === other.generatedName_1))
      return false;
    return true;
  };
  function ProviderPlaylistResult(header, entries, groups, groupOrder) {
    this.header_1 = header;
    this.entries_1 = entries;
    this.groups_1 = groups;
    this.groupOrder_1 = groupOrder;
  }
  protoOf(ProviderPlaylistResult).toString = function () {
    return 'ProviderPlaylistResult(header=' + this.header_1 + ', entries=' + toString_1(this.entries_1) + ', groups=' + toString_1(this.groups_1) + ', groupOrder=' + toString_1(this.groupOrder_1) + ')';
  };
  protoOf(ProviderPlaylistResult).hashCode = function () {
    var result = getStringHashCode(this.header_1);
    result = imul(result, 31) + hashCode_0(this.entries_1) | 0;
    result = imul(result, 31) + hashCode_0(this.groups_1) | 0;
    result = imul(result, 31) + hashCode_0(this.groupOrder_1) | 0;
    return result;
  };
  protoOf(ProviderPlaylistResult).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof ProviderPlaylistResult))
      return false;
    if (!(this.header_1 === other.header_1))
      return false;
    if (!equals(this.entries_1, other.entries_1))
      return false;
    if (!equals(this.groups_1, other.groups_1))
      return false;
    if (!equals(this.groupOrder_1, other.groupOrder_1))
      return false;
    return true;
  };
  function quoted($this, text, name) {
    var marker = name + '="';
    var at = indexOf_3(text, marker, VOID, true);
    if (at < 0)
      return '';
    var start = at + marker.length | 0;
    var end = indexOf_2(text, _Char___init__impl__6a9atx(34), start);
    return end < 0 ? '' : substring(text, start, end);
  }
  function hours_0($this, text, fallback) {
    var tmp0 = listOf_0(['catchup-days', 'timeshift', 'tvg-rec']);
    var tmp$ret$0;
    $l$block: {
      // Inline function 'kotlin.collections.firstOrNull' call
      var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        if (contains_1(text, element)) {
          tmp$ret$0 = element;
          break $l$block;
        }
      }
      tmp$ret$0 = null;
    }
    var tmp0_elvis_lhs = tmp$ret$0;
    var tmp;
    if (tmp0_elvis_lhs == null) {
      return fallback;
    } else {
      tmp = tmp0_elvis_lhs;
    }
    var name = tmp;
    var number = $this.integer_6sycuc_k$($this.attribute_s7yxes_k$(text, name));
    return (isNaN_0(number) ? 0.0 : number) * 24;
  }
  function floatPrefix($this, value) {
    var input = CoreText_getInstance().trim$default_yjecrm_k$(value);
    if (startsWith(input, 'Infinity') || startsWith(input, '+Infinity'))
      return Infinity;
    if (startsWith(input, '-Infinity'))
      return -Infinity;
    var tmp;
    var tmp_0 = listOf_0([new Char(_Char___init__impl__6a9atx(43)), new Char(_Char___init__impl__6a9atx(45))]);
    var tmp_1 = firstOrNull_0(input);
    if (contains_0(tmp_0, tmp_1 == null ? null : new Char(tmp_1))) {
      tmp = 1;
    } else {
      tmp = 0;
    }
    var at = tmp;
    var digits = 0;
    $l$loop: while (true) {
      var tmp_2;
      if (at < input.length) {
        var containsArg = charCodeAt(input, at);
        tmp_2 = _Char___init__impl__6a9atx(48) <= containsArg ? containsArg <= _Char___init__impl__6a9atx(57) : false;
      } else {
        tmp_2 = false;
      }
      if (!tmp_2) {
        break $l$loop;
      }
      at = at + 1 | 0;
      digits = digits + 1 | 0;
    }
    var tmp_3 = getOrNull_1(input, at);
    if (equals(tmp_3 == null ? null : new Char(tmp_3), new Char(_Char___init__impl__6a9atx(46)))) {
      at = at + 1 | 0;
      $l$loop_0: while (true) {
        var tmp_4;
        if (at < input.length) {
          var containsArg_0 = charCodeAt(input, at);
          tmp_4 = _Char___init__impl__6a9atx(48) <= containsArg_0 ? containsArg_0 <= _Char___init__impl__6a9atx(57) : false;
        } else {
          tmp_4 = false;
        }
        if (!tmp_4) {
          break $l$loop_0;
        }
        at = at + 1 | 0;
        digits = digits + 1 | 0;
      }
    }
    if (digits === 0)
      return NaN;
    var tmp_5 = listOf_0([new Char(_Char___init__impl__6a9atx(101)), new Char(_Char___init__impl__6a9atx(69))]);
    var tmp_6 = getOrNull_1(input, at);
    if (contains_0(tmp_5, tmp_6 == null ? null : new Char(tmp_6))) {
      var end = at + 1 | 0;
      var tmp_7 = listOf_0([new Char(_Char___init__impl__6a9atx(43)), new Char(_Char___init__impl__6a9atx(45))]);
      var tmp_8 = getOrNull_1(input, end);
      if (contains_0(tmp_7, tmp_8 == null ? null : new Char(tmp_8))) {
        end = end + 1 | 0;
      }
      var from = end;
      $l$loop_1: while (true) {
        var tmp_9;
        if (end < input.length) {
          var containsArg_1 = charCodeAt(input, end);
          tmp_9 = _Char___init__impl__6a9atx(48) <= containsArg_1 ? containsArg_1 <= _Char___init__impl__6a9atx(57) : false;
        } else {
          tmp_9 = false;
        }
        if (!tmp_9) {
          break $l$loop_1;
        }
        end = end + 1 | 0;
      }
      if (end > from)
        at = end;
    }
    var tmp0_elvis_lhs = toDoubleOrNull(substring(input, 0, at));
    return tmp0_elvis_lhs == null ? NaN : tmp0_elvis_lhs;
  }
  function ProviderPlaylist() {
  }
  protoOf(ProviderPlaylist).blocks_90bblf_k$ = function (text) {
    return split(text, ['#EXTINF:']);
  };
  protoOf(ProviderPlaylist).attribute_s7yxes_k$ = function (text, name) {
    var marker = name + '=';
    var position = indexOf_3(text, marker);
    if (position < 0)
      return '';
    var start = position + marker.length | 0;
    if (start === text.length)
      return '';
    // Inline function 'kotlin.let' call
    var it = indexOf_3(text, marker, start);
    var boundary = it < 0 ? text.length : it;
    var tmp;
    if (charCodeAt(text, start) === _Char___init__impl__6a9atx(34)) {
      // Inline function 'kotlin.let' call
      var it_0 = indexOf_2(text, _Char___init__impl__6a9atx(34), start + 1 | 0);
      tmp = it_0 < 0 || it_0 > boundary ? boundary : it_0;
    } else {
      var tmp0 = until(start, boundary);
      var tmp$ret$4;
      $l$block: {
        // Inline function 'kotlin.collections.firstOrNull' call
        var inductionVariable = tmp0.first_1;
        var last = tmp0.last_1;
        if (inductionVariable <= last)
          do {
            var element = inductionVariable;
            inductionVariable = inductionVariable + 1 | 0;
            var it_1 = element;
            if (charCodeAt(text, it_1) === _Char___init__impl__6a9atx(32) || charCodeAt(text, it_1) === _Char___init__impl__6a9atx(44)) {
              tmp$ret$4 = element;
              break $l$block;
            }
          }
           while (!(element === last));
        tmp$ret$4 = null;
      }
      var tmp0_elvis_lhs = tmp$ret$4;
      tmp = tmp0_elvis_lhs == null ? boundary : tmp0_elvis_lhs;
    }
    var end = tmp;
    return substring(text, start + (charCodeAt(text, start) === _Char___init__impl__6a9atx(34) ? 1 : 0) | 0, end);
  };
  protoOf(ProviderPlaylist).integer_6sycuc_k$ = function (value) {
    var input = CoreText_getInstance().trim$default_yjecrm_k$(value);
    var tmp;
    var tmp_0;
    var tmp_1 = firstOrNull_0(input);
    if (equals(tmp_1 == null ? null : new Char(tmp_1), new Char(_Char___init__impl__6a9atx(43)))) {
      tmp_0 = true;
    } else {
      var tmp_2 = firstOrNull_0(input);
      tmp_0 = equals(tmp_2 == null ? null : new Char(tmp_2), new Char(_Char___init__impl__6a9atx(45)));
    }
    if (tmp_0) {
      tmp = 1;
    } else {
      tmp = 0;
    }
    var at = tmp;
    var start = at;
    $l$loop: while (true) {
      var tmp_3;
      if (at < input.length) {
        var containsArg = charCodeAt(input, at);
        tmp_3 = _Char___init__impl__6a9atx(48) <= containsArg ? containsArg <= _Char___init__impl__6a9atx(57) : false;
      } else {
        tmp_3 = false;
      }
      if (!tmp_3) {
        break $l$loop;
      }
      at = at + 1 | 0;
    }
    if (at === start)
      return NaN;
    var tmp0_elvis_lhs = toDoubleOrNull(substring(input, 0, at));
    return tmp0_elvis_lhs == null ? NaN : tmp0_elvis_lhs;
  };
  protoOf(ProviderPlaylist).read_70pny9_k$ = function (text, format, hash, fallbackHours) {
    var blocks = this.blocks_90bblf_k$(text);
    var header = blocks.get_c1px32_k$(0);
    // Inline function 'kotlin.collections.linkedMapOf' call
    var entries = LinkedHashMap_init_$Create$();
    // Inline function 'kotlin.collections.linkedMapOf' call
    var groups = LinkedHashMap_init_$Create$();
    // Inline function 'kotlin.collections.mutableMapOf' call
    var categories = LinkedHashMap_init_$Create$();
    var generic = format.equals(ProviderPlaylistFormat_GENERIC_getInstance());
    var previousGroup = '';
    var defaultHours = hours_0(this, header, fallbackHours);
    // Inline function 'kotlin.text.ifEmpty' call
    var this_0 = this.attribute_s7yxes_k$(header, 'catchup');
    var tmp;
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(this_0) === 0) {
      tmp = ProviderPlaylist_instance.attribute_s7yxes_k$(header, 'catchup-type');
    } else {
      tmp = this_0;
    }
    var defaultMode = tmp;
    var defaultSource = this.attribute_s7yxes_k$(header, 'catchup-source');
    var _iterator__ex2g4s = drop(blocks, 1).iterator_jk1svi_k$();
    $l$loop_2: while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var block = _iterator__ex2g4s.next_20eer_k$();
      var lines = split_0(block, charArrayOf([_Char___init__impl__6a9atx(10)]));
      var raw = lines.get_c1px32_k$(0);
      var group = generic ? quoted(this, raw, 'group-title') : this.attribute_s7yxes_k$(raw, 'group-title');
      var url = '';
      var _iterator__ex2g4s_0 = drop(lines, 1).iterator_jk1svi_k$();
      $l$loop_0: while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
        var line = _iterator__ex2g4s_0.next_20eer_k$();
        var value = CoreText_getInstance().trim$default_yjecrm_k$(line);
        var tmp_0;
        if (generic) {
          // Inline function 'kotlin.text.isEmpty' call
          tmp_0 = charSequenceLength(value) === 0;
        } else {
          tmp_0 = false;
        }
        if (tmp_0)
          continue $l$loop_0;
        if (!startsWith_0(value, _Char___init__impl__6a9atx(35))) {
          url = value;
          break $l$loop_0;
        }
        var tmp_1;
        var tmp_2;
        if (!generic) {
          // Inline function 'kotlin.text.isEmpty' call
          var this_1 = group;
          tmp_2 = charSequenceLength(this_1) === 0;
        } else {
          tmp_2 = false;
        }
        if (tmp_2) {
          tmp_1 = contains_1(value, '#EXTGRP:');
        } else {
          tmp_1 = false;
        }
        if (tmp_1)
          group = CoreText_getInstance().trim$default_yjecrm_k$(substringBefore_0(substringAfter_0(value, '#EXTGRP:'), '#EXTGRP:'));
      }
      var tmp_3;
      if (generic) {
        // Inline function 'kotlin.text.isEmpty' call
        var this_2 = url;
        tmp_3 = charSequenceLength(this_2) === 0;
      } else {
        tmp_3 = false;
      }
      if (tmp_3)
        continue $l$loop_2;
      // Inline function 'kotlin.text.isEmpty' call
      var this_3 = group;
      if (charSequenceLength(this_3) === 0) {
        // Inline function 'kotlin.text.ifEmpty' call
        var this_4 = previousGroup;
        var tmp_4;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_4) === 0) {
          tmp_4 = generic ? 'Other' : '';
        } else {
          tmp_4 = this_4;
        }
        group = tmp_4;
      } else {
        previousGroup = group;
      }
      if (generic)
        previousGroup = group;
      var comma = indexOf_2(raw, _Char___init__impl__6a9atx(44));
      var title = comma > 0 ? CoreText_getInstance().trim$default_yjecrm_k$(substring_0(raw, comma + 1 | 0)) : '';
      var epgId = generic ? '' : this.attribute_s7yxes_k$(raw, 'tvg-id');
      var epgName = generic ? '' : this.attribute_s7yxes_k$(raw, 'tvg-name');
      var tmp_5;
      if (generic) {
        tmp_5 = comma > 0 ? title : '???';
      } else if (comma > 0) {
        // Inline function 'kotlin.text.ifEmpty' call
        var tmp_6;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(title) === 0) {
          tmp_6 = epgName;
        } else {
          tmp_6 = title;
        }
        // Inline function 'kotlin.text.ifEmpty' call
        var this_5 = tmp_6;
        var tmp_7;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_5) === 0) {
          tmp_7 = epgId;
        } else {
          tmp_7 = this_5;
        }
        tmp_5 = tmp_7;
      } else {
        tmp_5 = '';
      }
      var name = tmp_5;
      var tmp_8;
      if (!generic) {
        // Inline function 'kotlin.text.isEmpty' call
        tmp_8 = charSequenceLength(name) === 0;
      } else {
        tmp_8 = false;
      }
      var generated = tmp_8;
      var id = hash(url);
      var tmp_9;
      // Inline function 'kotlin.text.isNotEmpty' call
      var this_6 = group;
      if (charSequenceLength(this_6) > 0) {
        tmp_9 = !(id === 0.0);
      } else {
        tmp_9 = false;
      }
      if (tmp_9) {
        // Inline function 'kotlin.collections.getOrPut' call
        var key = group;
        var value_0 = groups.get_wei43m_k$(key);
        var tmp_10;
        if (value_0 == null) {
          var tmp2 = group;
          // Inline function 'kotlin.collections.set' call
          var value_1 = groups.get_size_woubt6_k$() + 2 | 0;
          categories.put_4fpzoq_k$(tmp2, value_1);
          // Inline function 'kotlin.collections.mutableListOf' call
          var answer = ArrayList_init_$Create$();
          groups.put_4fpzoq_k$(key, answer);
          tmp_10 = answer;
        } else {
          tmp_10 = value_0;
        }
        tmp_10.add_utx5q5_k$(id);
      }
      var tmp_11;
      // Inline function 'kotlin.text.isEmpty' call
      var this_7 = url;
      if (charSequenceLength(this_7) === 0) {
        tmp_11 = true;
      } else {
        tmp_11 = entries.containsKey_aw81wo_k$(id);
      }
      if (tmp_11)
        continue $l$loop_2;
      var tmp_12;
      if (generic) {
        tmp_12 = quoted(this, raw, 'tvg-logo');
      } else {
        // Inline function 'kotlin.takeIf' call
        var this_8 = this.attribute_s7yxes_k$(raw, 'tvg-logo');
        var tmp_13;
        if (startsWith(this_8, '//') || startsWith(this_8, 'http', true)) {
          tmp_13 = this_8;
        } else {
          tmp_13 = null;
        }
        // Inline function 'kotlin.text.orEmpty' call
        var tmp0_elvis_lhs = tmp_13;
        tmp_12 = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
      }
      var logo = tmp_12;
      var tmp_14;
      if (generic) {
        tmp_14 = 0.0;
      } else {
        // Inline function 'kotlin.let' call
        var it = floatPrefix(this, this.attribute_s7yxes_k$(raw, 'tvg-shift'));
        var tmp_15;
        if (isNaN_0(it) || it === 0.0) {
          tmp_15 = 0.0;
        } else {
          // Inline function 'kotlin.math.floor' call
          var x = it * -3600;
          tmp_15 = Math.floor(x);
        }
        tmp_14 = tmp_15;
      }
      var shift = tmp_14;
      var tmp_16 = url;
      var tmp_17 = group;
      var tmp0_elvis_lhs_0 = categories.get_wei43m_k$(group);
      var tmp_18 = tmp0_elvis_lhs_0 == null ? 1 : tmp0_elvis_lhs_0;
      var tmp_19 = generic ? name : epgName;
      var tmp_20 = generic ? 0.0 : hours_0(this, raw, defaultHours);
      var tmp_21;
      if (generic) {
        tmp_21 = '';
      } else {
        // Inline function 'kotlin.text.ifEmpty' call
        var this_9 = this.attribute_s7yxes_k$(raw, 'catchup');
        var tmp_22;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_9) === 0) {
          tmp_22 = ProviderPlaylist_instance.attribute_s7yxes_k$(raw, 'catchup-type');
        } else {
          tmp_22 = this_9;
        }
        // Inline function 'kotlin.text.ifEmpty' call
        var this_10 = tmp_22;
        var tmp_23;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_10) === 0) {
          tmp_23 = defaultMode;
        } else {
          tmp_23 = this_10;
        }
        tmp_21 = tmp_23;
      }
      var tmp_24 = tmp_21;
      var tmp_25;
      if (generic) {
        tmp_25 = '';
      } else {
        // Inline function 'kotlin.text.ifEmpty' call
        var this_11 = this.attribute_s7yxes_k$(raw, 'catchup-source');
        var tmp_26;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_11) === 0) {
          tmp_26 = defaultSource;
        } else {
          tmp_26 = this_11;
        }
        tmp_25 = tmp_26;
      }
      // Inline function 'kotlin.collections.set' call
      var value_2 = new ProviderPlaylistEntry(id, name, tmp_16, tmp_17, tmp_18, logo, epgId, tmp_19, tmp_20, tmp_24, tmp_25, shift, raw, comma > 0 ? title : '', generated);
      entries.put_4fpzoq_k$(id, value_2);
    }
    return new ProviderPlaylistResult(header, toList_0(entries.get_values_ksazhn_k$()), groups, toList_0(groups.get_keys_wop4xp_k$()));
  };
  var ProviderPlaylist_instance;
  function ProviderPlaylist_getInstance() {
    return ProviderPlaylist_instance;
  }
  function ProviderPlaylistFormat_GENERIC_getInstance() {
    static_init_8();
    return ProviderPlaylistFormat_GENERIC_instance;
  }
  function ProviderPlaylistFormat_M3U_getInstance() {
    static_init_8();
    return ProviderPlaylistFormat_M3U_instance;
  }
  var static_init_called_9;
  function static_init_9() {
    if (static_init_called_9)
      return Unit_instance;
    static_init_called_9 = true;
    ProviderValueKind_MISSING_instance = new ProviderValueKind('MISSING', 0);
    ProviderValueKind_NULL_instance = new ProviderValueKind('NULL', 1);
    ProviderValueKind_TEXT_instance = new ProviderValueKind('TEXT', 2);
    ProviderValueKind_NUMBER_instance = new ProviderValueKind('NUMBER', 3);
    ProviderValueKind_BOOLEAN_instance = new ProviderValueKind('BOOLEAN', 4);
    ProviderValueKind_ARRAY_instance = new ProviderValueKind('ARRAY', 5);
    ProviderValueKind_OBJECT_instance = new ProviderValueKind('OBJECT', 6);
  }
  var ProviderValueKind_MISSING_instance;
  var ProviderValueKind_NULL_instance;
  var ProviderValueKind_TEXT_instance;
  var ProviderValueKind_NUMBER_instance;
  var ProviderValueKind_BOOLEAN_instance;
  var ProviderValueKind_ARRAY_instance;
  var ProviderValueKind_OBJECT_instance;
  function ProviderValueKind(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function Companion_13() {
    Companion_instance_13 = this;
    this.missing_1 = new ProviderValue(ProviderValueKind_MISSING_getInstance());
    this.nil_1 = new ProviderValue(ProviderValueKind_NULL_getInstance());
  }
  protoOf(Companion_13).text_yxj031_k$ = function (value) {
    return new ProviderValue(ProviderValueKind_TEXT_getInstance(), value);
  };
  protoOf(Companion_13).array_vqz2lg_k$ = function (values) {
    return new ProviderValue(ProviderValueKind_ARRAY_getInstance(), VOID, values);
  };
  protoOf(Companion_13).array$default_yx37t8_k$ = function (values, $super) {
    values = values === VOID ? emptyList() : values;
    return $super === VOID ? this.array_vqz2lg_k$(values) : $super.array_vqz2lg_k$.call(this, values);
  };
  protoOf(Companion_13).obj_60q8ki_k$ = function (values) {
    return new ProviderValue(ProviderValueKind_OBJECT_getInstance(), VOID, VOID, values);
  };
  var Companion_instance_13;
  function Companion_getInstance_13() {
    if (Companion_instance_13 == null)
      new Companion_13();
    return Companion_instance_13;
  }
  function ProviderValue$string$lambda(it) {
    return it.get_present_3zxuem_k$() ? it.string_er2cq7_k$() : '';
  }
  function ProviderValue(kind, scalar, elements, properties) {
    Companion_getInstance_13();
    scalar = scalar === VOID ? '' : scalar;
    elements = elements === VOID ? emptyList() : elements;
    properties = properties === VOID ? emptyMap() : properties;
    this.kind_1 = kind;
    this.scalar_1 = scalar;
    this.elements_1 = elements;
    this.properties_1 = properties;
  }
  protoOf(ProviderValue).get_6bo4tg_k$ = function (key) {
    var tmp0_elvis_lhs = this.properties_1.get_wei43m_k$(key);
    return tmp0_elvis_lhs == null ? Companion_getInstance_13().missing_1 : tmp0_elvis_lhs;
  };
  protoOf(ProviderValue).get_isArray_z8qxd2_k$ = function () {
    return this.kind_1.equals(ProviderValueKind_ARRAY_getInstance());
  };
  protoOf(ProviderValue).get_isObject_xg6v9u_k$ = function () {
    return this.kind_1.equals(ProviderValueKind_OBJECT_getInstance());
  };
  protoOf(ProviderValue).get_present_3zxuem_k$ = function () {
    return !this.kind_1.equals(ProviderValueKind_MISSING_getInstance()) && !this.kind_1.equals(ProviderValueKind_NULL_getInstance());
  };
  protoOf(ProviderValue).primitive_uceazd_k$ = function () {
    return listOf_0([ProviderValueKind_TEXT_getInstance(), ProviderValueKind_NUMBER_getInstance(), ProviderValueKind_BOOLEAN_getInstance()]).contains_aljjnj_k$(this.kind_1) ? this.scalar_1 : '';
  };
  protoOf(ProviderValue).string_er2cq7_k$ = function () {
    var tmp;
    switch (this.kind_1.ordinal_1) {
      case 0:
        tmp = 'undefined';
        break;
      case 1:
        tmp = 'null';
        break;
      case 5:
        tmp = joinToString_0(this.elements_1, ',', VOID, VOID, VOID, VOID, ProviderValue$string$lambda);
        break;
      case 6:
        tmp = '[object Object]';
        break;
      default:
        tmp = this.scalar_1;
        break;
    }
    return tmp;
  };
  protoOf(ProviderValue).trimmed_hix7di_k$ = function () {
    return this.get_present_3zxuem_k$() ? CoreText_getInstance().trim$default_yjecrm_k$(this.string_er2cq7_k$()) : '';
  };
  protoOf(ProviderValue).truthy_eb26j6_k$ = function () {
    var tmp;
    switch (this.kind_1.ordinal_1) {
      case 0:
      case 1:
        tmp = false;
        break;
      case 2:
        // Inline function 'kotlin.text.isNotEmpty' call

        var this_0 = this.scalar_1;
        tmp = charSequenceLength(this_0) > 0;
        break;
      case 3:
        var tmp1_safe_receiver = toDoubleOrNull(this.scalar_1);
        var tmp_0;
        if (tmp1_safe_receiver == null) {
          tmp_0 = null;
        } else {
          // Inline function 'kotlin.let' call
          tmp_0 = (!(tmp1_safe_receiver === 0.0) && !isNaN_0(tmp1_safe_receiver));
        }

        var tmp2_elvis_lhs = tmp_0;
        tmp = tmp2_elvis_lhs == null ? false : tmp2_elvis_lhs;
        break;
      case 4:
        tmp = this.scalar_1 === 'true';
        break;
      default:
        tmp = true;
        break;
    }
    return tmp;
  };
  protoOf(ProviderValue).number_h3u0fr_k$ = function () {
    switch (this.kind_1.ordinal_1) {
      case 0:
        return NaN;
      case 1:
        return 0.0;
      case 4:
        return this.scalar_1 === 'true' ? 1.0 : 0.0;
      default:
        return CoreNumber_instance.javascript_5uxq0d_k$(this.string_er2cq7_k$());
    }
  };
  protoOf(ProviderValue).positive_cd8261_k$ = function () {
    // Inline function 'kotlin.takeIf' call
    var this_0 = this.number_h3u0fr_k$();
    var tmp;
    if (isFinite(this_0) && this_0 > 0) {
      tmp = this_0;
    } else {
      tmp = null;
    }
    var tmp0_elvis_lhs = tmp;
    return tmp0_elvis_lhs == null ? 0.0 : tmp0_elvis_lhs;
  };
  protoOf(ProviderValue).numericId_swg6iw_k$ = function () {
    var tmp;
    var tmp_0;
    if (this.get_present_3zxuem_k$()) {
      // Inline function 'kotlin.text.isNotEmpty' call
      var this_0 = this.string_er2cq7_k$();
      tmp_0 = charSequenceLength(this_0) > 0;
    } else {
      tmp_0 = false;
    }
    if (tmp_0) {
      var tmp0 = this.string_er2cq7_k$();
      var tmp$ret$1;
      $l$block: {
        // Inline function 'kotlin.text.all' call
        var inductionVariable = 0;
        while (inductionVariable < charSequenceLength(tmp0)) {
          var element = charSequenceGet(tmp0, inductionVariable);
          inductionVariable = inductionVariable + 1 | 0;
          if (!(_Char___init__impl__6a9atx(48) <= element ? element <= _Char___init__impl__6a9atx(57) : false)) {
            tmp$ret$1 = false;
            break $l$block;
          }
        }
        tmp$ret$1 = true;
      }
      tmp = tmp$ret$1;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(ProviderValue).flag_1vf58_k$ = function () {
    return this.kind_1.equals(ProviderValueKind_BOOLEAN_getInstance()) && this.scalar_1 === 'true' || this.string_er2cq7_k$() === '1';
  };
  function CoreNumber() {
  }
  protoOf(CoreNumber).javascript_5uxq0d_k$ = function (value) {
    var input = CoreText_getInstance().trim$default_yjecrm_k$(value);
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(input) === 0)
      return 0.0;
    // Inline function 'kotlin.text.lowercase' call
    // Inline function 'kotlin.js.asDynamic' call
    var radix;
    switch (take_0(input, 2).toLowerCase()) {
      case '0x':
        radix = 16;
        break;
      case '0b':
        radix = 2;
        break;
      case '0o':
        radix = 8;
        break;
      default:
        radix = 0;
        break;
    }
    if (!(radix === 0)) {
      if (input.length === 2)
        return NaN;
      var number = 0.0;
      var indexedObject = drop_0(input, 2);
      var inductionVariable = 0;
      var last = indexedObject.length;
      while (inductionVariable < last) {
        var character = charCodeAt(indexedObject, inductionVariable);
        inductionVariable = inductionVariable + 1 | 0;
        var tmp;
        if (_Char___init__impl__6a9atx(48) <= character ? character <= _Char___init__impl__6a9atx(57) : false) {
          // Inline function 'kotlin.code' call
          var tmp_0 = Char__toInt_impl_vasixd(character);
          // Inline function 'kotlin.code' call
          var this_0 = _Char___init__impl__6a9atx(48);
          tmp = tmp_0 - Char__toInt_impl_vasixd(this_0) | 0;
        } else if (_Char___init__impl__6a9atx(97) <= character ? character <= _Char___init__impl__6a9atx(102) : false) {
          // Inline function 'kotlin.code' call
          var tmp_1 = Char__toInt_impl_vasixd(character);
          // Inline function 'kotlin.code' call
          var this_1 = _Char___init__impl__6a9atx(97);
          tmp = (tmp_1 - Char__toInt_impl_vasixd(this_1) | 0) + 10 | 0;
        } else if (_Char___init__impl__6a9atx(65) <= character ? character <= _Char___init__impl__6a9atx(70) : false) {
          // Inline function 'kotlin.code' call
          var tmp_2 = Char__toInt_impl_vasixd(character);
          // Inline function 'kotlin.code' call
          var this_2 = _Char___init__impl__6a9atx(65);
          tmp = (tmp_2 - Char__toInt_impl_vasixd(this_2) | 0) + 10 | 0;
        } else {
          return NaN;
        }
        var digit = tmp;
        if (digit >= radix)
          return NaN;
        number = number * radix + digit;
      }
      return number;
    }
    if (input === 'Infinity' || input === '+Infinity')
      return Infinity;
    if (input === '-Infinity')
      return -Infinity;
    var tmp_3;
    var tmp_4 = listOf_0([new Char(_Char___init__impl__6a9atx(43)), new Char(_Char___init__impl__6a9atx(45))]);
    var tmp_5 = firstOrNull_0(input);
    if (contains_0(tmp_4, tmp_5 == null ? null : new Char(tmp_5))) {
      tmp_3 = 1;
    } else {
      tmp_3 = 0;
    }
    var at = tmp_3;
    var digits = 0;
    $l$loop: while (true) {
      var tmp_6;
      if (at < input.length) {
        var containsArg = charCodeAt(input, at);
        tmp_6 = _Char___init__impl__6a9atx(48) <= containsArg ? containsArg <= _Char___init__impl__6a9atx(57) : false;
      } else {
        tmp_6 = false;
      }
      if (!tmp_6) {
        break $l$loop;
      }
      at = at + 1 | 0;
      digits = digits + 1 | 0;
    }
    var tmp_7 = getOrNull_1(input, at);
    if (equals(tmp_7 == null ? null : new Char(tmp_7), new Char(_Char___init__impl__6a9atx(46)))) {
      at = at + 1 | 0;
      $l$loop_0: while (true) {
        var tmp_8;
        if (at < input.length) {
          var containsArg_0 = charCodeAt(input, at);
          tmp_8 = _Char___init__impl__6a9atx(48) <= containsArg_0 ? containsArg_0 <= _Char___init__impl__6a9atx(57) : false;
        } else {
          tmp_8 = false;
        }
        if (!tmp_8) {
          break $l$loop_0;
        }
        at = at + 1 | 0;
        digits = digits + 1 | 0;
      }
    }
    if (digits === 0)
      return NaN;
    var tmp_9 = listOf_0([new Char(_Char___init__impl__6a9atx(101)), new Char(_Char___init__impl__6a9atx(69))]);
    var tmp_10 = getOrNull_1(input, at);
    if (contains_0(tmp_9, tmp_10 == null ? null : new Char(tmp_10))) {
      at = at + 1 | 0;
      var tmp_11 = listOf_0([new Char(_Char___init__impl__6a9atx(43)), new Char(_Char___init__impl__6a9atx(45))]);
      var tmp_12 = getOrNull_1(input, at);
      if (contains_0(tmp_11, tmp_12 == null ? null : new Char(tmp_12))) {
        at = at + 1 | 0;
      }
      var start = at;
      $l$loop_1: while (true) {
        var tmp_13;
        if (at < input.length) {
          var containsArg_1 = charCodeAt(input, at);
          tmp_13 = _Char___init__impl__6a9atx(48) <= containsArg_1 ? containsArg_1 <= _Char___init__impl__6a9atx(57) : false;
        } else {
          tmp_13 = false;
        }
        if (!tmp_13) {
          break $l$loop_1;
        }
        at = at + 1 | 0;
      }
      if (start === at)
        return NaN;
    }
    var tmp_14;
    if (at === input.length) {
      var tmp2_elvis_lhs = toDoubleOrNull(input);
      tmp_14 = tmp2_elvis_lhs == null ? NaN : tmp2_elvis_lhs;
    } else {
      tmp_14 = NaN;
    }
    return tmp_14;
  };
  var CoreNumber_instance;
  function CoreNumber_getInstance() {
    return CoreNumber_instance;
  }
  function ProviderValueKind_MISSING_getInstance() {
    static_init_9();
    return ProviderValueKind_MISSING_instance;
  }
  function ProviderValueKind_NULL_getInstance() {
    static_init_9();
    return ProviderValueKind_NULL_instance;
  }
  function ProviderValueKind_TEXT_getInstance() {
    static_init_9();
    return ProviderValueKind_TEXT_instance;
  }
  function ProviderValueKind_NUMBER_getInstance() {
    static_init_9();
    return ProviderValueKind_NUMBER_instance;
  }
  function ProviderValueKind_BOOLEAN_getInstance() {
    static_init_9();
    return ProviderValueKind_BOOLEAN_instance;
  }
  function ProviderValueKind_ARRAY_getInstance() {
    static_init_9();
    return ProviderValueKind_ARRAY_instance;
  }
  function ProviderValueKind_OBJECT_getInstance() {
    static_init_9();
    return ProviderValueKind_OBJECT_instance;
  }
  function current($this, node) {
    return node.get_6bo4tg_k$('portalGeneration').kind_1.equals(ProviderValueKind_NUMBER_getInstance()) && node.get_6bo4tg_k$('portalGeneration').number_h3u0fr_k$() === $this.generation_1;
  }
  function StalkerBrowserSession$link$lambda(it) {
    return '';
  }
  function StalkerBrowserSession(source, generation, fingerprint, component, resolve, absolute) {
    this.source_1 = source;
    this.generation_1 = generation;
    this.fingerprint_1 = fingerprint;
    this.component_1 = component;
    this.resolve_1 = resolve;
    this.absolute_1 = absolute;
    this.token_1 = '';
    var tmp = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    tmp.references_1 = LinkedHashMap_init_$Create$();
  }
  protoOf(StalkerBrowserSession).get_prefix_xpqhdw_k$ = function () {
    return this.component_1(CoreText_getInstance().trim$default_yjecrm_k$(this.source_1)) + ':stalker:';
  };
  protoOf(StalkerBrowserSession).verify_r6shw1_k$ = function (value) {
    if (!(value === this.fingerprint_1))
      throw new StalkerFailure('SESSION_CATALOG');
  };
  protoOf(StalkerBrowserSession).load_ks1tnz_k$ = function (profile) {
    return new StalkerBrowserOperation(this, 'load', profile);
  };
  protoOf(StalkerBrowserSession).browse_ar72c3_k$ = function (node) {
    if (!current(this, node))
      throw new StalkerFailure('SESSION_FOLDER');
    var folder = node.get_6bo4tg_k$('folderType').string_er2cq7_k$();
    if (!listOf_0(['portal-vod', 'portal-category', 'portal-movie', 'portal-season', 'portal-episode']).contains_aljjnj_k$(folder))
      throw new StalkerFailure('UNSUPPORTED_FOLDER');
    return new StalkerBrowserOperation(this, folder === 'portal-vod' ? 'categories' : 'browse', node);
  };
  protoOf(StalkerBrowserSession).playback_dhnsfw_k$ = function (node) {
    var item = this.references_1.get_wei43m_k$(node.get_6bo4tg_k$('id').string_er2cq7_k$());
    if (item == null || !current(this, node))
      throw new StalkerFailure('SESSION_PLAYBACK');
    return new StalkerBrowserOperation(this, 'resolve', node, StalkerProtocol_instance.linkRequest_tlix8n_k$(item.command_1, node.get_6bo4tg_k$('kind').string_er2cq7_k$(), item.series_1, StalkerFormat_BROWSER_getInstance()));
  };
  protoOf(StalkerBrowserSession).items_vp090i_k$ = function (rows, kind, parent, groups, catalog) {
    // Inline function 'kotlin.collections.mutableListOf' call
    var items = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.mutableListOf' call
    var warnings = ArrayList_init_$Create$();
    var _iterator__ex2g4s = rows.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var row = _iterator__ex2g4s.next_20eer_k$();
      var item = StalkerCatalogs_instance.browserItem_bkx9hr_k$(row, this.source_1, kind, parent, groups, this.component_1, this.resolve_1);
      if (item == null)
        warnings.add_utx5q5_k$('Ignored a portal item without a supported media reference');
      else {
        items.add_utx5q5_k$(item);
        // Inline function 'kotlin.text.isEmpty' call
        var this_0 = item.folder_1;
        if (charSequenceLength(this_0) === 0) {
          var tmp0 = this.references_1;
          // Inline function 'kotlin.collections.set' call
          var key = item.id_1;
          tmp0.put_4fpzoq_k$(key, item);
        }
      }
    }
    if (catalog) {
      items.add_utx5q5_k$(new StalkerItem(this.get_prefix_xpqhdw_k$() + 'vod-root', '', 'Movies and series', 'folder', 'Movies', VOID, VOID, VOID, VOID, VOID, 'portal-vod'));
    }
    return new StalkerResult(items, warnings, catalog);
  };
  protoOf(StalkerBrowserSession).categories_gat97e_k$ = function (data) {
    if (!data.get_isArray_z8qxd2_k$())
      throw new StalkerFailure('CATEGORIES_FORMAT');
    // Inline function 'kotlin.collections.mutableSetOf' call
    var seen = LinkedHashSet_init_$Create$();
    // Inline function 'kotlin.collections.mutableListOf' call
    var items = ArrayList_init_$Create$();
    var _iterator__ex2g4s = data.elements_1.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var row = _iterator__ex2g4s.next_20eer_k$();
      if (row.truthy_eb26j6_k$() && row.get_6bo4tg_k$('id').get_present_3zxuem_k$() && seen.add_utx5q5_k$(row.get_6bo4tg_k$('id').string_er2cq7_k$())) {
        var id = row.get_6bo4tg_k$('id').string_er2cq7_k$();
        var tmp = this.get_prefix_xpqhdw_k$() + 'category:' + this.component_1(id);
        // Inline function 'kotlin.text.ifEmpty' call
        var this_0 = row.get_6bo4tg_k$('title').trimmed_hix7di_k$();
        var tmp_0;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_0) === 0) {
          tmp_0 = 'Movies';
        } else {
          tmp_0 = this_0;
        }
        var tmp$ret$2 = tmp_0;
        items.add_utx5q5_k$(new StalkerItem(tmp, id, tmp$ret$2, 'folder', 'Movies', VOID, VOID, VOID, row.get_6bo4tg_k$('censored').flag_1vf58_k$(), VOID, 'portal-category', VOID, VOID, VOID, Companion_getInstance_13().text_yxj031_k$(id)));
      }
    }
    return new StalkerResult(items);
  };
  protoOf(StalkerBrowserSession).link_irpt1g_k$ = function (data) {
    var tmp = StalkerProtocol_instance;
    var tmp_0 = StalkerFormat_BROWSER_getInstance();
    return tmp.link_mgv4m6_k$(data, tmp_0, this.absolute_1, StalkerBrowserSession$link$lambda);
  };
  function StalkerBrowserOperation$pages$lambda(it) {
    return it.get_6bo4tg_k$('id').string_er2cq7_k$();
  }
  function StalkerBrowserOperation(session, mode, node, link) {
    link = link === VOID ? null : link;
    this.session_1 = session;
    this.mode_1 = mode;
    this.node_1 = node;
    this.link_1 = link;
    this.stage_1 = 0;
    this.groups_1 = emptyMap();
    var tmp = this;
    var tmp_0 = StalkerFormat_BROWSER_getInstance();
    tmp.pages_1 = new StalkerPages(tmp_0, StalkerBrowserOperation$pages$lambda);
    this.result_1 = null;
    this.url_1 = null;
  }
  protoOf(StalkerBrowserOperation).get_request_jdwg4m_k$ = function () {
    if (!(this.result_1 == null) || !(this.url_1 == null))
      return null;
    if (this.mode_1 === 'resolve')
      return this.link_1;
    if (this.mode_1 === 'categories')
      return new StalkerRequest('vod', 'get_categories');
    if (this.mode_1 === 'load') {
      switch (this.stage_1) {
        case 0:
          return StalkerProtocol_instance.handshake_162won_k$();
        case 1:
          return StalkerProtocol_instance.profileRequest_7lydna_k$(this.node_1, StalkerFormat_BROWSER_getInstance());
        case 2:
          return new StalkerRequest('itv', 'get_genres');
        default:
          return this.pages_1.request_wolyya_k$('itv', stalkerValues([to('genre', '*')]));
      }
    }
    var filters = linkedMapOf([to('category', firstTruthy([this.node_1.get_6bo4tg_k$('categoryId'), Companion_getInstance_13().text_yxj031_k$('*')])), to('genre', Companion_getInstance_13().text_yxj031_k$('*'))]);
    var folder = this.node_1.get_6bo4tg_k$('folderType').string_er2cq7_k$();
    if (listOf_0(['portal-movie', 'portal-season', 'portal-episode']).contains_aljjnj_k$(folder)) {
      var tmp2 = 'movie_id';
      // Inline function 'kotlin.collections.set' call
      var value = this.node_1.get_6bo4tg_k$('movieId');
      filters.put_4fpzoq_k$(tmp2, value);
    }
    if (listOf_0(['portal-season', 'portal-episode']).contains_aljjnj_k$(folder)) {
      var tmp2_0 = 'season_id';
      // Inline function 'kotlin.collections.set' call
      var value_0 = this.node_1.get_6bo4tg_k$('seasonId');
      filters.put_4fpzoq_k$(tmp2_0, value_0);
    }
    if (folder === 'portal-episode') {
      var tmp2_1 = 'episode_id';
      // Inline function 'kotlin.collections.set' call
      var value_1 = this.node_1.get_6bo4tg_k$('episodeId');
      filters.put_4fpzoq_k$(tmp2_1, value_1);
    }
    return this.pages_1.request_wolyya_k$('vod', filters);
  };
  protoOf(StalkerBrowserOperation).accept_wd2l5t_k$ = function (response) {
    // Inline function 'kotlin.check' call
    if (!!(this.get_request_jdwg4m_k$() == null)) {
      throw IllegalStateException_init_$Create$_0('Check failed.');
    }
    var data = StalkerProtocol_instance.unwrap_gye7zb_k$(response, StalkerFormat_BROWSER_getInstance());
    switch (this.mode_1) {
      case 'resolve':
        this.url_1 = this.session_1.link_irpt1g_k$(data);
        break;
      case 'categories':
        this.result_1 = this.session_1.categories_gat97e_k$(data);
        break;
      case 'load':
        switch (this.stage_1) {
          case 0:
            this.session_1.token_1 = StalkerProtocol_instance.token_yq7enx_k$(data, StalkerFormat_BROWSER_getInstance());
            this.stage_1 = this.stage_1 + 1 | 0;
            break;
          case 1:
            StalkerProtocol_instance.profile_dvdwte_k$(data);
            this.stage_1 = this.stage_1 + 1 | 0;
            break;
          case 2:
            this.groups_1 = StalkerCatalogs_instance.groups_hxfv8o_k$(data, StalkerFormat_BROWSER_getInstance());
            this.stage_1 = this.stage_1 + 1 | 0;
            break;
          default:
            this.pages_1.accept_wd2l5t_k$(data);
            if (this.pages_1.done_1)
              this.result_1 = this.session_1.items_vp090i_k$(this.pages_1.get_rows_wott7m_k$(), 'live', Companion_getInstance_13().missing_1, this.groups_1, true);
            break;
        }

        break;
      default:
        this.pages_1.accept_wd2l5t_k$(data);
        if (this.pages_1.done_1)
          this.result_1 = this.session_1.items_vp090i_k$(this.pages_1.get_rows_wott7m_k$(), 'vod', this.node_1, emptyMap(), false);
        break;
    }
  };
  function StalkerPages(format, identity) {
    this.format_1 = format;
    this.identity_1 = identity;
    this.page_1 = 1;
    this.done_1 = false;
    this.rawCount_1 = 0;
    this.expected_1 = null;
    var tmp = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp.records_1 = LinkedHashMap_init_$Create$();
  }
  protoOf(StalkerPages).get_rows_wott7m_k$ = function () {
    return toList_0(this.records_1.get_values_ksazhn_k$());
  };
  protoOf(StalkerPages).accept_wd2l5t_k$ = function (value) {
    // Inline function 'kotlin.check' call
    if (!!this.done_1) {
      throw IllegalStateException_init_$Create$_0('Check failed.');
    }
    var browser = this.format_1.equals(StalkerFormat_BROWSER_getInstance());
    var rows = !browser && value.get_isArray_z8qxd2_k$() ? value : value.get_6bo4tg_k$('data');
    if (!rows.get_isArray_z8qxd2_k$())
      throw new StalkerFailure(browser ? 'PAGE_FORMAT' : 'NATIVE_PAGE');
    var tmp;
    if (browser) {
      var tmp_0;
      if (!value.get_6bo4tg_k$('total_items').get_present_3zxuem_k$()) {
        tmp_0 = null;
      } else {
        // Inline function 'kotlin.also' call
        var this_0 = value.get_6bo4tg_k$('total_items').number_h3u0fr_k$();
        var tmp_1;
        if (!isFinite(this_0) || this_0 < 0) {
          tmp_1 = true;
        } else {
          // Inline function 'kotlin.math.floor' call
          tmp_1 = !(Math.floor(this_0) === this_0);
        }
        if (tmp_1)
          throw new StalkerFailure('TOTAL_FORMAT');
        tmp_0 = this_0;
      }
      tmp = tmp_0;
    } else {
      var tmp0_safe_receiver = toIntOrNull(value.get_6bo4tg_k$('total_items').primitive_uceazd_k$());
      tmp = tmp0_safe_receiver == null ? null : tmp0_safe_receiver;
    }
    var total = tmp;
    if (!(total == null) && total > (browser ? 50000 : 100000))
      throw new StalkerFailure(browser ? 'BROWSER_COUNT' : 'NATIVE_COUNT');
    if (!browser && !(total == null) && total >= 0)
      this.expected_1 = numberToInt(total);
    var before = this.records_1.get_size_woubt6_k$();
    var _iterator__ex2g4s = rows.elements_1.iterator_jk1svi_k$();
    $l$loop: while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var row = _iterator__ex2g4s.next_20eer_k$();
      if (browser && (!row.truthy_eb26j6_k$() || !row.get_6bo4tg_k$('id').get_present_3zxuem_k$()))
        throw new StalkerFailure('ROW_ID');
      var tmp1_elvis_lhs = this.identity_1(row);
      var tmp_2;
      if (tmp1_elvis_lhs == null) {
        continue $l$loop;
      } else {
        tmp_2 = tmp1_elvis_lhs;
      }
      var id = tmp_2;
      var tmp_3;
      if (!browser) {
        tmp_3 = true;
      } else {
        // Inline function 'kotlin.collections.contains' call
        // Inline function 'kotlin.collections.containsKey' call
        var this_1 = this.records_1;
        tmp_3 = !(isInterface(this_1, KtMap) ? this_1 : THROW_CCE()).containsKey_aw81wo_k$(id);
      }
      if (tmp_3) {
        // Inline function 'kotlin.collections.set' call
        this.records_1.put_4fpzoq_k$(id, row);
      }
    }
    this.rawCount_1 = this.rawCount_1 + rows.elements_1.get_size_woubt6_k$() | 0;
    if (browser) {
      if (rows.elements_1.isEmpty_y1axqb_k$() && !(total == null) && this.rawCount_1 < total)
        throw new StalkerFailure('EARLY_PAGE');
      var tmp_4;
      // Inline function 'kotlin.collections.isNotEmpty' call
      if (!rows.elements_1.isEmpty_y1axqb_k$()) {
        tmp_4 = this.records_1.get_size_woubt6_k$() === before;
      } else {
        tmp_4 = false;
      }
      if (tmp_4)
        throw new StalkerFailure('REPEAT_PAGE');
      if (rows.elements_1.isEmpty_y1axqb_k$() || (!(total == null) && this.rawCount_1 >= total)) {
        this.done_1 = true;
        return Unit_instance;
      }
      if (this.page_1 >= 5000 || this.records_1.get_size_woubt6_k$() >= 50000)
        throw new StalkerFailure('PAGE_LIMIT');
    } else {
      if (rows.elements_1.isEmpty_y1axqb_k$()) {
        if (!(this.expected_1 == null) && this.records_1.get_size_woubt6_k$() < ensureNotNull(this.expected_1))
          throw new StalkerFailure('NATIVE_EARLY');
        this.done_1 = true;
        return Unit_instance;
      }
      if (!(this.expected_1 == null) && this.records_1.get_size_woubt6_k$() >= ensureNotNull(this.expected_1)) {
        this.done_1 = true;
        return Unit_instance;
      }
      if (this.records_1.get_size_woubt6_k$() === before)
        throw new StalkerFailure('NATIVE_REPEAT');
      var size = toIntOrNull(value.get_6bo4tg_k$('max_page_items').primitive_uceazd_k$());
      if (this.expected_1 == null && (value.get_isArray_z8qxd2_k$() || (!(size == null) && rows.elements_1.get_size_woubt6_k$() < size))) {
        this.done_1 = true;
        return Unit_instance;
      }
      if (this.page_1 >= 1000)
        throw new StalkerFailure('NATIVE_PAGE_LIMIT');
    }
    this.page_1 = this.page_1 + 1 | 0;
  };
  protoOf(StalkerPages).request_wolyya_k$ = function (type, filters) {
    var tmp;
    if (this.format_1.equals(StalkerFormat_BROWSER_getInstance())) {
      // Inline function 'kotlin.apply' call
      var this_0 = stalkerValues([to('p', this.page_1.toString()), to('fav', '0'), to('sortby', type === 'itv' ? 'number' : 'name')]);
      this_0.putAll_wgg6cj_k$(filters);
      tmp = this_0;
    } else {
      tmp = stalkerValues([to('genre', '*'), to('p', this.page_1.toString()), to('fav', '0'), to('sortby', 'number'), to('hd', '0')]);
    }
    var params = tmp;
    return new StalkerRequest(type, 'get_ordered_list', params);
  };
  function StalkerCatalogs() {
  }
  protoOf(StalkerCatalogs).groups_hxfv8o_k$ = function (data, format) {
    if (!data.get_isArray_z8qxd2_k$())
      throw new StalkerFailure(format.equals(StalkerFormat_BROWSER_getInstance()) ? 'GENRES_FORMAT' : 'NATIVE_GENRES');
    // Inline function 'kotlin.collections.linkedMapOf' call
    var groups = LinkedHashMap_init_$Create$();
    var _iterator__ex2g4s = data.elements_1.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var row = _iterator__ex2g4s.next_20eer_k$();
      if (format.equals(StalkerFormat_BROWSER_getInstance())) {
        if (row.truthy_eb26j6_k$() && row.get_6bo4tg_k$('id').get_present_3zxuem_k$()) {
          var tmp2 = row.get_6bo4tg_k$('id').string_er2cq7_k$();
          // Inline function 'kotlin.text.ifEmpty' call
          var this_0 = row.get_6bo4tg_k$('title').trimmed_hix7di_k$();
          var tmp;
          // Inline function 'kotlin.text.isEmpty' call
          if (charSequenceLength(this_0) === 0) {
            tmp = 'Other';
          } else {
            tmp = this_0;
          }
          // Inline function 'kotlin.collections.set' call
          var value = tmp;
          groups.put_4fpzoq_k$(tmp2, value);
        }
      } else if (row.get_isObject_xg6v9u_k$()) {
        var tmp2_0 = row.get_6bo4tg_k$('id').primitive_uceazd_k$();
        // Inline function 'kotlin.text.ifBlank' call
        var this_1 = row.get_6bo4tg_k$('title').primitive_uceazd_k$();
        var tmp_0;
        if (isBlank(this_1)) {
          tmp_0 = row.get_6bo4tg_k$('name').primitive_uceazd_k$();
        } else {
          tmp_0 = this_1;
        }
        // Inline function 'kotlin.collections.set' call
        var value_0 = tmp_0;
        groups.put_4fpzoq_k$(tmp2_0, value_0);
      }
    }
    return groups;
  };
  protoOf(StalkerCatalogs).browserItem_bkx9hr_k$ = function (row, source, kind, node, groups, component, resolve) {
    var id = row.get_6bo4tg_k$('id').trimmed_hix7di_k$();
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(id) === 0)
      return null;
    var folder = '';
    var movie = node.get_6bo4tg_k$('movieId');
    var season = node.get_6bo4tg_k$('seasonId');
    var episode = node.get_6bo4tg_k$('episodeId');
    if (kind === 'vod')
      if (row.get_6bo4tg_k$('is_season').flag_1vf58_k$()) {
        folder = 'portal-season';
        season = Companion_getInstance_13().text_yxj031_k$(id);
      } else if (row.get_6bo4tg_k$('is_episode').flag_1vf58_k$()) {
        folder = 'portal-episode';
        episode = Companion_getInstance_13().text_yxj031_k$(id);
      } else if (row.get_6bo4tg_k$('is_series').flag_1vf58_k$() || row.get_6bo4tg_k$('has_files').positive_cd8261_k$() > 0) {
        folder = 'portal-movie';
        movie = Companion_getInstance_13().text_yxj031_k$(id);
      }
    var command = row.get_6bo4tg_k$('cmd').trimmed_hix7di_k$();
    var tmp;
    // Inline function 'kotlin.text.isEmpty' call
    var this_0 = folder;
    if (charSequenceLength(this_0) === 0) {
      var tmp_0;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(command) === 0) {
        tmp_0 = true;
      } else {
        var tmp$ret$3;
        $l$block: {
          // Inline function 'kotlin.text.any' call
          var inductionVariable = 0;
          while (inductionVariable < charSequenceLength(command)) {
            var element = charSequenceGet(command, inductionVariable);
            inductionVariable = inductionVariable + 1 | 0;
            if (contains_2('\r\n\x00', element)) {
              tmp$ret$3 = true;
              break $l$block;
            }
          }
          tmp$ret$3 = false;
        }
        tmp_0 = tmp$ret$3;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    if (tmp)
      return null;
    var tmp_1 = component(CoreText_getInstance().trim$default_yjecrm_k$(source)) + ':stalker:';
    // Inline function 'kotlin.text.ifEmpty' call
    var this_1 = folder;
    var tmp_2;
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(this_1) === 0) {
      tmp_2 = kind;
    } else {
      tmp_2 = this_1;
    }
    var tmp_3 = tmp_1 + tmp_2 + ':' + component(id);
    // Inline function 'kotlin.text.ifEmpty' call
    var this_2 = firstTruthy([row.get_6bo4tg_k$('name'), row.get_6bo4tg_k$('title')]).trimmed_hix7di_k$();
    var tmp_4;
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(this_2) === 0) {
      tmp_4 = 'Item ' + id;
    } else {
      tmp_4 = this_2;
    }
    var tmp_5 = tmp_4;
    var tmp_6;
    // Inline function 'kotlin.text.isEmpty' call
    var this_3 = folder;
    if (charSequenceLength(this_3) === 0) {
      tmp_6 = kind;
    } else {
      tmp_6 = 'folder';
    }
    var tmp_7 = tmp_6;
    // Inline function 'kotlin.text.orEmpty' call
    var tmp0_elvis_lhs = groups.get_wei43m_k$(row.get_6bo4tg_k$('tv_genre_id').string_er2cq7_k$());
    // Inline function 'kotlin.text.ifEmpty' call
    var this_4 = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
    var tmp_8;
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(this_4) === 0) {
      tmp_8 = node.get_6bo4tg_k$('name').truthy_eb26j6_k$() ? node.get_6bo4tg_k$('name').string_er2cq7_k$() : 'Other';
    } else {
      tmp_8 = this_4;
    }
    var tmp$ret$13 = tmp_8;
    return new StalkerItem(tmp_3, id, tmp_5, tmp_7, tmp$ret$13, resolve(firstTruthy([row.get_6bo4tg_k$('logo'), row.get_6bo4tg_k$('screenshot_uri')]).trimmed_hix7di_k$()), row.get_6bo4tg_k$('xmltv_id').trimmed_hix7di_k$(), row.get_6bo4tg_k$('description').trimmed_hix7di_k$(), row.get_6bo4tg_k$('censored').flag_1vf58_k$() || row.get_6bo4tg_k$('lock').flag_1vf58_k$() || node.get_6bo4tg_k$('adult').truthy_eb26j6_k$(), VOID, folder, movie, season, episode, node.get_6bo4tg_k$('categoryId'), command, firstTruthy([row.get_6bo4tg_k$('series_number'), new ProviderValue(ProviderValueKind_NUMBER_getInstance(), '0')]));
  };
  var StalkerCatalogs_instance;
  function StalkerCatalogs_getInstance() {
    return StalkerCatalogs_instance;
  }
  var static_init_called_10;
  function static_init_10() {
    if (static_init_called_10)
      return Unit_instance;
    static_init_called_10 = true;
    StalkerFormat_BROWSER_instance = new StalkerFormat('BROWSER', 0);
    StalkerFormat_NATIVE_instance = new StalkerFormat('NATIVE', 1);
    StalkerFormat_RPC_instance = new StalkerFormat('RPC', 2);
  }
  var StalkerFormat_BROWSER_instance;
  var StalkerFormat_NATIVE_instance;
  var StalkerFormat_RPC_instance;
  function StalkerFormat(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function StalkerFailure(code) {
    Exception_init_$Init$_0(code, this);
    captureStack(this, StalkerFailure);
    this.code_1 = code;
  }
  function StalkerRequest(type, action, params) {
    params = params === VOID ? emptyMap() : params;
    this.type_1 = type;
    this.action_1 = action;
    this.params_1 = params;
  }
  protoOf(StalkerRequest).toString = function () {
    return 'StalkerRequest(type=' + this.type_1 + ', action=' + this.action_1 + ', params=' + toString_1(this.params_1) + ')';
  };
  protoOf(StalkerRequest).hashCode = function () {
    var result = getStringHashCode(this.type_1);
    result = imul(result, 31) + getStringHashCode(this.action_1) | 0;
    result = imul(result, 31) + hashCode_0(this.params_1) | 0;
    return result;
  };
  protoOf(StalkerRequest).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof StalkerRequest))
      return false;
    if (!(this.type_1 === other.type_1))
      return false;
    if (!(this.action_1 === other.action_1))
      return false;
    if (!equals(this.params_1, other.params_1))
      return false;
    return true;
  };
  function StalkerLocation(endpoint, referer) {
    this.endpoint_1 = endpoint;
    this.referer_1 = referer;
  }
  protoOf(StalkerLocation).toString = function () {
    return 'StalkerLocation(endpoint=' + this.endpoint_1 + ', referer=' + this.referer_1 + ')';
  };
  protoOf(StalkerLocation).hashCode = function () {
    var result = getStringHashCode(this.endpoint_1);
    result = imul(result, 31) + getStringHashCode(this.referer_1) | 0;
    return result;
  };
  protoOf(StalkerLocation).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof StalkerLocation))
      return false;
    if (!(this.endpoint_1 === other.endpoint_1))
      return false;
    if (!(this.referer_1 === other.referer_1))
      return false;
    return true;
  };
  function StalkerItem(id, providerId, name, kind, group, logo, epgId, description, adult, url, folder, movie, season, episode, category, command, series, generatedName, generatedGroup) {
    kind = kind === VOID ? 'live' : kind;
    group = group === VOID ? 'Other' : group;
    logo = logo === VOID ? '' : logo;
    epgId = epgId === VOID ? '' : epgId;
    description = description === VOID ? '' : description;
    adult = adult === VOID ? false : adult;
    url = url === VOID ? '' : url;
    folder = folder === VOID ? '' : folder;
    movie = movie === VOID ? Companion_getInstance_13().missing_1 : movie;
    season = season === VOID ? Companion_getInstance_13().missing_1 : season;
    episode = episode === VOID ? Companion_getInstance_13().missing_1 : episode;
    category = category === VOID ? Companion_getInstance_13().missing_1 : category;
    command = command === VOID ? '' : command;
    series = series === VOID ? Companion_getInstance_13().missing_1 : series;
    generatedName = generatedName === VOID ? false : generatedName;
    generatedGroup = generatedGroup === VOID ? false : generatedGroup;
    this.id_1 = id;
    this.providerId_1 = providerId;
    this.name_1 = name;
    this.kind_1 = kind;
    this.group_1 = group;
    this.logo_1 = logo;
    this.epgId_1 = epgId;
    this.description_1 = description;
    this.adult_1 = adult;
    this.url_1 = url;
    this.folder_1 = folder;
    this.movie_1 = movie;
    this.season_1 = season;
    this.episode_1 = episode;
    this.category_1 = category;
    this.command_1 = command;
    this.series_1 = series;
    this.generatedName_1 = generatedName;
    this.generatedGroup_1 = generatedGroup;
  }
  protoOf(StalkerItem).toString = function () {
    return 'StalkerItem(id=' + this.id_1 + ', providerId=' + this.providerId_1 + ', name=' + this.name_1 + ', kind=' + this.kind_1 + ', group=' + this.group_1 + ', logo=' + this.logo_1 + ', epgId=' + this.epgId_1 + ', description=' + this.description_1 + ', adult=' + this.adult_1 + ', url=' + this.url_1 + ', folder=' + this.folder_1 + ', movie=' + toString_1(this.movie_1) + ', season=' + toString_1(this.season_1) + ', episode=' + toString_1(this.episode_1) + ', category=' + toString_1(this.category_1) + ', command=' + this.command_1 + ', series=' + toString_1(this.series_1) + ', generatedName=' + this.generatedName_1 + ', generatedGroup=' + this.generatedGroup_1 + ')';
  };
  protoOf(StalkerItem).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + getStringHashCode(this.providerId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.name_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.kind_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.group_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.logo_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.epgId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.description_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.adult_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.url_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.folder_1) | 0;
    result = imul(result, 31) + hashCode_0(this.movie_1) | 0;
    result = imul(result, 31) + hashCode_0(this.season_1) | 0;
    result = imul(result, 31) + hashCode_0(this.episode_1) | 0;
    result = imul(result, 31) + hashCode_0(this.category_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.command_1) | 0;
    result = imul(result, 31) + hashCode_0(this.series_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.generatedName_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.generatedGroup_1) | 0;
    return result;
  };
  protoOf(StalkerItem).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof StalkerItem))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!(this.providerId_1 === other.providerId_1))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    if (!(this.kind_1 === other.kind_1))
      return false;
    if (!(this.group_1 === other.group_1))
      return false;
    if (!(this.logo_1 === other.logo_1))
      return false;
    if (!(this.epgId_1 === other.epgId_1))
      return false;
    if (!(this.description_1 === other.description_1))
      return false;
    if (!(this.adult_1 === other.adult_1))
      return false;
    if (!(this.url_1 === other.url_1))
      return false;
    if (!(this.folder_1 === other.folder_1))
      return false;
    if (!equals(this.movie_1, other.movie_1))
      return false;
    if (!equals(this.season_1, other.season_1))
      return false;
    if (!equals(this.episode_1, other.episode_1))
      return false;
    if (!equals(this.category_1, other.category_1))
      return false;
    if (!(this.command_1 === other.command_1))
      return false;
    if (!equals(this.series_1, other.series_1))
      return false;
    if (!(this.generatedName_1 === other.generatedName_1))
      return false;
    if (!(this.generatedGroup_1 === other.generatedGroup_1))
      return false;
    return true;
  };
  function StalkerResult(items, warnings, catalog) {
    warnings = warnings === VOID ? emptyList() : warnings;
    catalog = catalog === VOID ? false : catalog;
    this.items_1 = items;
    this.warnings_1 = warnings;
    this.catalog_1 = catalog;
  }
  protoOf(StalkerResult).toString = function () {
    return 'StalkerResult(items=' + toString_1(this.items_1) + ', warnings=' + toString_1(this.warnings_1) + ', catalog=' + this.catalog_1 + ')';
  };
  protoOf(StalkerResult).hashCode = function () {
    var result = hashCode_0(this.items_1);
    result = imul(result, 31) + hashCode_0(this.warnings_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.catalog_1) | 0;
    return result;
  };
  protoOf(StalkerResult).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof StalkerResult))
      return false;
    if (!equals(this.items_1, other.items_1))
      return false;
    if (!equals(this.warnings_1, other.warnings_1))
      return false;
    if (!(this.catalog_1 === other.catalog_1))
      return false;
    return true;
  };
  function stalkerValues(pairs) {
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(pairs.length);
    var inductionVariable = 0;
    var last = pairs.length;
    while (inductionVariable < last) {
      var item = pairs[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var tmp$ret$2 = to(item.first_1, Companion_getInstance_13().text_yxj031_k$(item.second_1));
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    var tmp$ret$3 = copyToArray(destination);
    return linkedMapOf(tmp$ret$3.slice());
  }
  function firstTruthy(values) {
    var tmp$ret$0;
    $l$block: {
      // Inline function 'kotlin.collections.firstOrNull' call
      var inductionVariable = 0;
      var last = values.length;
      while (inductionVariable < last) {
        var element = values[inductionVariable];
        inductionVariable = inductionVariable + 1 | 0;
        if (element.truthy_eb26j6_k$()) {
          tmp$ret$0 = element;
          break $l$block;
        }
      }
      tmp$ret$0 = null;
    }
    var tmp0_elvis_lhs = tmp$ret$0;
    var tmp1_elvis_lhs = tmp0_elvis_lhs == null ? lastOrNull(values) : tmp0_elvis_lhs;
    return tmp1_elvis_lhs == null ? Companion_getInstance_13().missing_1 : tmp1_elvis_lhs;
  }
  function StalkerProtocol() {
  }
  protoOf(StalkerProtocol).handshake_162won_k$ = function () {
    return new StalkerRequest('stb', 'handshake', stalkerValues([to('token', '')]));
  };
  protoOf(StalkerProtocol).browserLocation_gt1sir_k$ = function (url) {
    var clean = substringBefore(substringBefore(url, _Char___init__impl__6a9atx(63)), _Char___init__impl__6a9atx(35));
    // Inline function 'kotlin.text.lowercase' call
    // Inline function 'kotlin.js.asDynamic' call
    var lower = clean.toLowerCase();
    var tmp0 = listOf_0(['/c/index.html/', '/c/index.html', '/c/', '/c']);
    var tmp$ret$2;
    $l$block: {
      // Inline function 'kotlin.collections.firstOrNull' call
      var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        if (endsWith(lower, element)) {
          tmp$ret$2 = element;
          break $l$block;
        }
      }
      tmp$ret$2 = null;
    }
    var suffix = tmp$ret$2;
    if (!(suffix == null)) {
      var base = dropLast(clean, suffix.length);
      return new StalkerLocation(base + '/server/load.php', base + '/c/');
    }
    var tmp0_0 = listOf_0(['/server/load.php', '/portal.php', '/load.php']);
    var tmp$ret$4;
    $l$block_0: {
      // Inline function 'kotlin.collections.firstOrNull' call
      var _iterator__ex2g4s_0 = tmp0_0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
        var element_0 = _iterator__ex2g4s_0.next_20eer_k$();
        if (endsWith(lower, element_0)) {
          tmp$ret$4 = element_0;
          break $l$block_0;
        }
      }
      tmp$ret$4 = null;
    }
    var tmp0_elvis_lhs = tmp$ret$4;
    var tmp;
    if (tmp0_elvis_lhs == null) {
      throw new StalkerFailure('PORTAL_URL');
    } else {
      tmp = tmp0_elvis_lhs;
    }
    var endpoint = tmp;
    return new StalkerLocation(clean, dropLast(clean, endpoint.length) + '/c/');
  };
  protoOf(StalkerProtocol).validMac_ac1bdz_k$ = function (mac) {
    var tmp;
    if (mac.length === 17) {
      var tmp0 = withIndex(mac);
      var tmp$ret$0;
      $l$block_0: {
        // Inline function 'kotlin.collections.all' call
        var tmp_0;
        if (isInterface(tmp0, Collection)) {
          tmp_0 = tmp0.isEmpty_y1axqb_k$();
        } else {
          tmp_0 = false;
        }
        if (tmp_0) {
          tmp$ret$0 = true;
          break $l$block_0;
        }
        var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
        while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
          var element = _iterator__ex2g4s.next_20eer_k$();
          var i = element.component1_7eebsc_k$();
          var c = element.component2_7eebsb_k$().value_1;
          var tmp_1;
          if ((i % 3 | 0) === 2) {
            tmp_1 = c === _Char___init__impl__6a9atx(58);
          } else {
            var tmp_2;
            if (_Char___init__impl__6a9atx(48) <= c ? c <= _Char___init__impl__6a9atx(57) : false) {
              tmp_2 = true;
            } else {
              var containsArg = uppercaseChar(c);
              tmp_2 = _Char___init__impl__6a9atx(65) <= containsArg ? containsArg <= _Char___init__impl__6a9atx(70) : false;
            }
            tmp_1 = tmp_2;
          }
          if (!tmp_1) {
            tmp$ret$0 = false;
            break $l$block_0;
          }
        }
        tmp$ret$0 = true;
      }
      tmp = tmp$ret$0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(StalkerProtocol).browserConfiguration_wa9ah_k$ = function (url, mac, profile) {
    if (!this.validMac_ac1bdz_k$(mac))
      throw new StalkerFailure('SOURCE_MAC');
    var location = this.browserLocation_gt1sir_k$(url);
    var model = profile.get_6bo4tg_k$('stb_type');
    var tmp;
    if (model.get_present_3zxuem_k$()) {
      var tmp_0;
      var containsArg = model.string_er2cq7_k$().length;
      if (!(1 <= containsArg ? containsArg <= 40 : false)) {
        tmp_0 = true;
      } else {
        var tmp0 = model.string_er2cq7_k$();
        var tmp$ret$0;
        $l$block: {
          // Inline function 'kotlin.text.any' call
          var inductionVariable = 0;
          while (inductionVariable < charSequenceLength(tmp0)) {
            var element = charSequenceGet(tmp0, inductionVariable);
            inductionVariable = inductionVariable + 1 | 0;
            if (!(_Char___init__impl__6a9atx(97) <= element ? element <= _Char___init__impl__6a9atx(122) : false) && !(_Char___init__impl__6a9atx(65) <= element ? element <= _Char___init__impl__6a9atx(90) : false) && !(_Char___init__impl__6a9atx(48) <= element ? element <= _Char___init__impl__6a9atx(57) : false) && !(element === _Char___init__impl__6a9atx(95)) && !(element === _Char___init__impl__6a9atx(45))) {
              tmp$ret$0 = true;
              break $l$block;
            }
          }
          tmp$ret$0 = false;
        }
        tmp_0 = tmp$ret$0;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    if (tmp)
      throw new StalkerFailure('PORTAL_PROFILE');
    return location;
  };
  protoOf(StalkerProtocol).textDenied_kpfuc2_k$ = function (value) {
    // Inline function 'kotlin.text.lowercase' call
    // Inline function 'kotlin.js.asDynamic' call
    var text = CoreText_getInstance().trim$default_yjecrm_k$(value).toLowerCase();
    return startsWith(text, 'authorization failed') || startsWith(text, 'access denied');
  };
  protoOf(StalkerProtocol).unwrap_gye7zb_k$ = function (response, format) {
    if (format.equals(StalkerFormat_BROWSER_getInstance())) {
      if (!response.truthy_eb26j6_k$() || !response.properties_1.containsKey_aw81wo_k$('js'))
        throw new StalkerFailure('PORTAL_FORMAT');
      var data = response.get_6bo4tg_k$('js');
      if (data.truthy_eb26j6_k$() && (data.get_6bo4tg_k$('error').truthy_eb26j6_k$() || data.get_6bo4tg_k$('not_valid_token').flag_1vf58_k$()))
        throw new StalkerFailure('PORTAL_AUTH');
      return data;
    }
    if (!response.get_isObject_xg6v9u_k$())
      throw new StalkerFailure(format.equals(StalkerFormat_RPC_getInstance()) ? 'RPC_FORMAT' : 'NATIVE_FORMAT');
    if (format.equals(StalkerFormat_RPC_getInstance())) {
      if (response.get_6bo4tg_k$('error').get_present_3zxuem_k$())
        throw new StalkerFailure('RPC_ERROR');
      var result = response.get_6bo4tg_k$('result');
      if (!result.get_present_3zxuem_k$())
        throw new StalkerFailure('RPC_EMPTY');
      if (!result.get_isArray_z8qxd2_k$() && !result.get_isObject_xg6v9u_k$() && listOf_0(['false', '0', '']).contains_aljjnj_k$(result.primitive_uceazd_k$()))
        throw new StalkerFailure('RPC_REJECTED');
      return result;
    }
    var data_0 = response.properties_1.containsKey_aw81wo_k$('js') ? response.get_6bo4tg_k$('js') : response.get_6bo4tg_k$('result');
    if (data_0.kind_1.equals(ProviderValueKind_MISSING_getInstance()))
      throw new StalkerFailure('NATIVE_RESULT');
    if (data_0.kind_1.equals(ProviderValueKind_NULL_getInstance()))
      throw new StalkerFailure('NATIVE_EMPTY');
    var tmp;
    if (data_0.get_isObject_xg6v9u_k$()) {
      // Inline function 'kotlin.text.isNotBlank' call
      var this_0 = data_0.get_6bo4tg_k$('error').primitive_uceazd_k$();
      tmp = !isBlank(this_0);
    } else {
      tmp = false;
    }
    if (tmp)
      throw new StalkerFailure('NATIVE_REJECTED');
    return data_0;
  };
  protoOf(StalkerProtocol).token_yq7enx_k$ = function (data, format) {
    var token = format.equals(StalkerFormat_BROWSER_getInstance()) ? firstTruthy([data.get_6bo4tg_k$('token'), Companion_getInstance_13().text_yxj031_k$('')]).string_er2cq7_k$() : data.get_6bo4tg_k$('token').primitive_uceazd_k$();
    if (format.equals(StalkerFormat_BROWSER_getInstance())) {
      var plain = trimEnd(token, charArrayOf([_Char___init__impl__6a9atx(61)]));
      var padding = token.length - plain.length | 0;
      var tmp;
      var tmp_0;
      var containsArg = plain.length;
      if (!(1 <= containsArg ? containsArg <= 2048 : false)) {
        tmp_0 = true;
      } else {
        tmp_0 = padding > 2;
      }
      if (tmp_0) {
        tmp = true;
      } else {
        var tmp$ret$0;
        $l$block: {
          // Inline function 'kotlin.text.any' call
          var inductionVariable = 0;
          while (inductionVariable < charSequenceLength(plain)) {
            var element = charSequenceGet(plain, inductionVariable);
            inductionVariable = inductionVariable + 1 | 0;
            if (!(_Char___init__impl__6a9atx(97) <= element ? element <= _Char___init__impl__6a9atx(122) : false) && !(_Char___init__impl__6a9atx(65) <= element ? element <= _Char___init__impl__6a9atx(90) : false) && !(_Char___init__impl__6a9atx(48) <= element ? element <= _Char___init__impl__6a9atx(57) : false) && !contains_2('._~+/-', element)) {
              tmp$ret$0 = true;
              break $l$block;
            }
          }
          tmp$ret$0 = false;
        }
        tmp = tmp$ret$0;
      }
      if (tmp)
        throw new StalkerFailure('HANDSHAKE');
    } else if (isBlank(token))
      throw new StalkerFailure('NATIVE_HANDSHAKE');
    return token;
  };
  protoOf(StalkerProtocol).profile_dvdwte_k$ = function (data) {
    if (!data.get_isObject_xg6v9u_k$() || (!data.get_6bo4tg_k$('id').get_present_3zxuem_k$() && !data.get_6bo4tg_k$('status').get_present_3zxuem_k$()) || (data.get_6bo4tg_k$('status').get_present_3zxuem_k$() && !(data.get_6bo4tg_k$('status').string_er2cq7_k$() === '0')) || data.get_6bo4tg_k$('blocked').flag_1vf58_k$())
      throw new StalkerFailure('PROFILE_AUTH');
    if (data.get_6bo4tg_k$('auth_second_step').flag_1vf58_k$())
      throw new StalkerFailure('SECOND_AUTH');
  };
  protoOf(StalkerProtocol).profileRequest_7lydna_k$ = function (profile, format) {
    var values = format.equals(StalkerFormat_BROWSER_getInstance()) ? stalkerValues([to('stb_type', 'MAG250'), to('hd', '1'), to('auth_second_step', '0'), to('not_valid_token', '0')]) : stalkerValues([to('hd', '1')]);
    if (format.equals(StalkerFormat_BROWSER_getInstance())) {
      var _iterator__ex2g4s = listOf_0(['stb_type', 'sn', 'device_id', 'device_id2', 'signature', 'ver', 'image_version', 'hw_version']).iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var key = _iterator__ex2g4s.next_20eer_k$();
        if (profile.get_6bo4tg_k$(key).get_present_3zxuem_k$()) {
          // Inline function 'kotlin.collections.set' call
          var value = Companion_getInstance_13().text_yxj031_k$(profile.get_6bo4tg_k$(key).string_er2cq7_k$());
          values.put_4fpzoq_k$(key, value);
        }
      }
    }
    return new StalkerRequest('stb', 'get_profile', values);
  };
  protoOf(StalkerProtocol).query_vqjnuh_k$ = function (request, format) {
    var values = linkedMapOf([to('type', request.type_1), to('action', request.action_1)]);
    if (!format.equals(StalkerFormat_BROWSER_getInstance())) {
      // Inline function 'kotlin.collections.set' call
      var key = 'JsHttpRequest';
      values.put_4fpzoq_k$(key, '1-xml');
    }
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s = request.params_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var k = element.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var v = element.get_value_j01efc_k$();
      // Inline function 'kotlin.collections.set' call
      var value = v.string_er2cq7_k$();
      values.put_4fpzoq_k$(k, value);
    }
    if (format.equals(StalkerFormat_BROWSER_getInstance())) {
      // Inline function 'kotlin.collections.set' call
      var key_0 = 'JsHttpRequest';
      values.put_4fpzoq_k$(key_0, '1-xml');
    }
    return toList_1(values);
  };
  protoOf(StalkerProtocol).headers_parquy_k$ = function (mac, language, zone, profile, token, location, format, encode) {
    var browser = format.equals(StalkerFormat_BROWSER_getInstance());
    var tmp;
    if (browser) {
      tmp = 'mac=' + encode(mac) + '; stb_lang=' + encode(language) + '; timezone=' + encode(zone);
    } else {
      // Inline function 'kotlin.text.uppercase' call
      // Inline function 'kotlin.js.asDynamic' call
      tmp = 'mac=' + mac.toUpperCase() + '; stb_lang=en; timezone=UTC';
    }
    var headers = linkedMapOf([to('Cookie', tmp)]);
    if (browser) {
      // Inline function 'kotlin.collections.set' call
      var value = location.referer_1;
      headers.put_4fpzoq_k$('Referer', value);
    }
    var tmp2 = 'X-User-Agent';
    var tmp_0;
    if (browser) {
      // Inline function 'kotlin.text.ifEmpty' call
      var this_0 = profile.get_6bo4tg_k$('stb_type').trimmed_hix7di_k$();
      var tmp_1;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(this_0) === 0) {
        tmp_1 = 'MAG250';
      } else {
        tmp_1 = this_0;
      }
      tmp_0 = tmp_1;
    } else {
      tmp_0 = 'MAG250';
    }
    // Inline function 'kotlin.collections.set' call
    var value_0 = 'Model: ' + tmp_0 + '; Link: Ethernet';
    headers.put_4fpzoq_k$(tmp2, value_0);
    var tmp_2;
    if (!(token == null)) {
      var tmp_3;
      if (!browser) {
        tmp_3 = true;
      } else {
        // Inline function 'kotlin.text.isNotEmpty' call
        tmp_3 = charSequenceLength(token) > 0;
      }
      tmp_2 = tmp_3;
    } else {
      tmp_2 = false;
    }
    if (tmp_2) {
      var tmp2_0 = 'Authorization';
      // Inline function 'kotlin.collections.set' call
      var value_1 = 'Bearer ' + token;
      headers.put_4fpzoq_k$(tmp2_0, value_1);
    }
    return headers;
  };
  protoOf(StalkerProtocol).rpc_npxnyn_k$ = function (method, mac, params, legacy) {
    var values = toMutableMap(params);
    // Inline function 'kotlin.collections.getOrElse' call
    var tmp0_elvis_lhs = values.get_wei43m_k$('mac');
    var tmp;
    if (tmp0_elvis_lhs == null) {
      tmp = Companion_getInstance_13().missing_1;
    } else {
      tmp = tmp0_elvis_lhs;
    }
    if (!tmp.truthy_eb26j6_k$()) {
      // Inline function 'kotlin.collections.set' call
      var value = Companion_getInstance_13().text_yxj031_k$(mac);
      values.put_4fpzoq_k$('mac', value);
    }
    // Inline function 'kotlin.collections.linkedMapOf' call
    var body = LinkedHashMap_init_$Create$();
    if (legacy) {
      // Inline function 'kotlin.collections.set' call
      var value_0 = new ProviderValue(ProviderValueKind_NUMBER_getInstance(), '1');
      body.put_4fpzoq_k$('id', value_0);
    }
    // Inline function 'kotlin.collections.set' call
    var value_1 = Companion_getInstance_13().text_yxj031_k$('2.0');
    body.put_4fpzoq_k$('jsonrpc', value_1);
    // Inline function 'kotlin.collections.set' call
    var value_2 = new ProviderValue(ProviderValueKind_NUMBER_getInstance(), '1');
    body.put_4fpzoq_k$('id', value_2);
    // Inline function 'kotlin.collections.set' call
    var value_3 = Companion_getInstance_13().text_yxj031_k$(method);
    body.put_4fpzoq_k$('method', value_3);
    // Inline function 'kotlin.collections.set' call
    var value_4 = Companion_getInstance_13().obj_60q8ki_k$(values);
    body.put_4fpzoq_k$('params', value_4);
    return Companion_getInstance_13().obj_60q8ki_k$(body);
  };
  protoOf(StalkerProtocol).linkRequest_tlix8n_k$ = function (command, kind, series, format) {
    return new StalkerRequest(kind === 'live' ? 'itv' : 'vod', 'create_link', stalkerValues([to('cmd', command), to('series', series.truthy_eb26j6_k$() ? series.string_er2cq7_k$() : '0'), to('forced_storage', format.equals(StalkerFormat_BROWSER_getInstance()) ? 'undefined' : '0'), to('disable_ad', '0'), to('download', '0')]));
  };
  protoOf(StalkerProtocol).link_mgv4m6_k$ = function (data, format, resolve, hostname) {
    var tmp;
    if (format.equals(StalkerFormat_BROWSER_getInstance())) {
      tmp = data.get_6bo4tg_k$('cmd').trimmed_hix7di_k$();
    } else {
      // Inline function 'kotlin.text.ifBlank' call
      var this_0 = data.get_6bo4tg_k$('cmd').primitive_uceazd_k$();
      var tmp_0;
      if (isBlank(this_0)) {
        tmp_0 = data.primitive_uceazd_k$();
      } else {
        tmp_0 = this_0;
      }
      // Inline function 'kotlin.text.trim' call
      var this_1 = tmp_0;
      tmp = toString_1(trim(isCharSequence(this_1) ? this_1 : THROW_CCE()));
    }
    var command = tmp;
    var tmp0 = command;
    var tmp$ret$3;
    $l$block: {
      // Inline function 'kotlin.text.takeWhile' call
      var inductionVariable = 0;
      var last = tmp0.length;
      if (inductionVariable < last)
        do {
          var index = inductionVariable;
          inductionVariable = inductionVariable + 1 | 0;
          var it = charCodeAt(tmp0, index);
          var tmp_1;
          if (format.equals(StalkerFormat_BROWSER_getInstance())) {
            // Inline function 'kotlin.text.isNotEmpty' call
            var this_2 = CoreText_getInstance().trim$default_yjecrm_k$(toString(it));
            tmp_1 = charSequenceLength(this_2) > 0;
          } else {
            tmp_1 = !contains_2(' \t\r\n\x0B\f', it);
          }
          if (!tmp_1) {
            tmp$ret$3 = substring(tmp0, 0, index);
            break $l$block;
          }
        }
         while (inductionVariable < last);
      tmp$ret$3 = tmp0;
    }
    var prefix = tmp$ret$3;
    var allowed = format.equals(StalkerFormat_BROWSER_getInstance()) ? listOf_0(['ffmpeg', 'ffrt']) : listOf_0(['ffmpeg', 'ffrt', 'auto']);
    var tmp_2;
    // Inline function 'kotlin.text.lowercase' call
    // Inline function 'kotlin.js.asDynamic' call
    var tmp$ret$6 = prefix.toLowerCase();
    if (allowed.contains_aljjnj_k$(tmp$ret$6)) {
      tmp_2 = command.length > prefix.length;
    } else {
      tmp_2 = false;
    }
    if (tmp_2) {
      // Inline function 'kotlin.text.trimStart' call
      var this_3 = drop_0(command, prefix.length);
      command = toString_1(trimStart(isCharSequence(this_3) ? this_3 : THROW_CCE()));
    }
    if (!format.equals(StalkerFormat_BROWSER_getInstance())) {
      // Inline function 'kotlin.text.trim' call
      var this_4 = command;
      command = toString_1(trim(isCharSequence(this_4) ? this_4 : THROW_CCE()));
    }
    var url = resolve(command);
    // Inline function 'kotlin.text.isEmpty' call
    if (charSequenceLength(url) === 0)
      throw new StalkerFailure(format.equals(StalkerFormat_BROWSER_getInstance()) ? 'STREAM_URL' : 'NATIVE_LINK');
    if (!format.equals(StalkerFormat_BROWSER_getInstance()) && listOf_0(['localhost', '127.0.0.1', '::1']).contains_aljjnj_k$(hostname(url)))
      throw new StalkerFailure('LOCAL_LINK');
    return url;
  };
  var StalkerProtocol_instance;
  function StalkerProtocol_getInstance() {
    return StalkerProtocol_instance;
  }
  function StalkerFormat_BROWSER_getInstance() {
    static_init_10();
    return StalkerFormat_BROWSER_instance;
  }
  function StalkerFormat_RPC_getInstance() {
    static_init_10();
    return StalkerFormat_RPC_instance;
  }
  function StreamingGuideIdentity(id, tvgName, name, days) {
    this.id_1 = id;
    this.tvgName_1 = tvgName;
    this.name_1 = name;
    this.days_1 = days;
  }
  protoOf(StreamingGuideIdentity).get_names_ivn21r_k$ = function () {
    return listOf_0([this.tvgName_1, this.name_1]);
  };
  protoOf(StreamingGuideIdentity).toString = function () {
    return 'StreamingGuideIdentity(id=' + this.id_1 + ', tvgName=' + this.tvgName_1 + ', name=' + this.name_1 + ', days=' + this.days_1 + ')';
  };
  protoOf(StreamingGuideIdentity).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + getStringHashCode(this.tvgName_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.name_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.days_1) | 0;
    return result;
  };
  protoOf(StreamingGuideIdentity).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof StreamingGuideIdentity))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!(this.tvgName_1 === other.tvgName_1))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    if (!equals(this.days_1, other.days_1))
      return false;
    return true;
  };
  function StreamingGuideCoverage(start, end, programmeLimit, truncatedChannels) {
    this.start_1 = start;
    this.end_1 = end;
    this.programmeLimit_1 = programmeLimit;
    this.truncatedChannels_1 = truncatedChannels;
  }
  protoOf(StreamingGuideCoverage).toString = function () {
    return 'StreamingGuideCoverage(start=' + this.start_1 + ', end=' + this.end_1 + ', programmeLimit=' + this.programmeLimit_1 + ', truncatedChannels=' + this.truncatedChannels_1 + ')';
  };
  protoOf(StreamingGuideCoverage).hashCode = function () {
    var result = getNumberHashCode(this.start_1);
    result = imul(result, 31) + getNumberHashCode(this.end_1) | 0;
    result = imul(result, 31) + getNumberHashCode(this.programmeLimit_1) | 0;
    result = imul(result, 31) + this.truncatedChannels_1 | 0;
    return result;
  };
  protoOf(StreamingGuideCoverage).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof StreamingGuideCoverage))
      return false;
    if (!equals(this.start_1, other.start_1))
      return false;
    if (!equals(this.end_1, other.end_1))
      return false;
    if (!equals(this.programmeLimit_1, other.programmeLimit_1))
      return false;
    if (!(this.truncatedChannels_1 === other.truncatedChannels_1))
      return false;
    return true;
  };
  function Entry_0(id, start, end, payload) {
    this.id_1 = id;
    this.start_1 = start;
    this.end_1 = end;
    this.payload_1 = payload;
  }
  function retainDepth($this, index, key, days) {
    // Inline function 'kotlin.text.isNotEmpty' call
    if (charSequenceLength(key) > 0) {
      var tmp0_elvis_lhs = index.get_wei43m_k$(key);
      // Inline function 'kotlin.comparisons.maxOf' call
      var a = tmp0_elvis_lhs == null ? 1.0 : tmp0_elvis_lhs;
      // Inline function 'kotlin.collections.set' call
      var value = Math.max(a, days);
      index.put_4fpzoq_k$(key, value);
    }
  }
  function priority($this, entry) {
    var tmp;
    if (entry.start_1 <= $this.clock_1 && (entry.end_1 == null || entry.end_1 > $this.clock_1)) {
      tmp = -1.0E12 + $this.clock_1 - entry.start_1;
    } else if ($this.nextEntries_1.get_wei43m_k$(entry.id_1) === entry) {
      tmp = -5.0E11 + entry.start_1 - $this.clock_1;
    } else {
      // Inline function 'kotlin.math.abs' call
      var x = entry.start_1 - $this.clock_1;
      tmp = Math.abs(x);
    }
    return tmp;
  }
  function Companion_14() {
  }
  protoOf(Companion_14).identities_h380h1_k$ = function (rows) {
    // Inline function 'kotlin.collections.linkedMapOf' call
    var result = LinkedHashMap_init_$Create$();
    var _iterator__ex2g4s = rows.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var raw = _iterator__ex2g4s.next_20eer_k$();
      var key = new Triple(CoreText_getInstance().trim$default_yjecrm_k$(raw.id_1), GuideNames_instance.normalized_qcj5er_k$(raw.tvgName_1), GuideNames_instance.normalized_qcj5er_k$(raw.name_1));
      var tmp;
      var tmp_0;
      // Inline function 'kotlin.text.isNotEmpty' call
      var this_0 = key.first_1;
      if (charSequenceLength(this_0) > 0) {
        tmp_0 = true;
      } else {
        // Inline function 'kotlin.text.isNotEmpty' call
        var this_1 = key.second_1;
        tmp_0 = charSequenceLength(this_1) > 0;
      }
      if (tmp_0) {
        tmp = true;
      } else {
        // Inline function 'kotlin.text.isNotEmpty' call
        var this_2 = key.third_1;
        tmp = charSequenceLength(this_2) > 0;
      }
      // Inline function 'kotlin.require' call
      // Inline function 'kotlin.require' call
      if (!tmp) {
        var message = 'Failed requirement.';
        throw IllegalArgumentException_init_$Create$_0(toString_1(message));
      }
      var tmp2 = raw.days_1;
      var tmp0_safe_receiver = result.get_wei43m_k$(key);
      var tmp1_elvis_lhs = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.days_1;
      // Inline function 'kotlin.comparisons.maxOf' call
      var c = tmp1_elvis_lhs == null ? 0.0 : tmp1_elvis_lhs;
      var tmp$ret$7 = Math.max(1.0, tmp2, c);
      // Inline function 'kotlin.collections.set' call
      var value = new StreamingGuideIdentity(key.first_1, key.second_1, key.third_1, tmp$ret$7);
      result.put_4fpzoq_k$(key, value);
    }
    return toList_0(result.get_values_ksazhn_k$());
  };
  var Companion_instance_14;
  function Companion_getInstance_14() {
    return Companion_instance_14;
  }
  function sam$kotlin_Comparator$0_4(function_0) {
    this.function_1 = function_0;
  }
  protoOf(sam$kotlin_Comparator$0_4).compare_bczr_k$ = function (a, b) {
    return this.function_1(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_4).compare = function (a, b) {
    return this.compare_bczr_k$(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_4).getFunctionDelegate_jtodtf_k$ = function () {
    return this.function_1;
  };
  protoOf(sam$kotlin_Comparator$0_4).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, Comparator) : false) {
      var tmp_0;
      if (!(other == null) ? isInterface(other, FunctionAdapter) : false) {
        tmp_0 = equals(this.getFunctionDelegate_jtodtf_k$(), other.getFunctionDelegate_jtodtf_k$());
      } else {
        tmp_0 = false;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(sam$kotlin_Comparator$0_4).hashCode = function () {
    return hashCode_0(this.getFunctionDelegate_jtodtf_k$());
  };
  function StreamingGuide$programme$lambda(this$0) {
    return function (a, b) {
      // Inline function 'kotlin.comparisons.compareValuesBy' call
      var this_0 = this$0;
      var tmp = priority(this_0, a);
      var this_1 = this$0;
      var tmp$ret$2 = priority(this_1, b);
      return compareValues(tmp, tmp$ret$2);
    };
  }
  function StreamingGuide$output$lambda($entries) {
    return function (it) {
      return $entries.get_c1px32_k$(it).start_1;
    };
  }
  function StreamingGuide$output$lambda_0($entries) {
    return function (it) {
      var tmp0_elvis_lhs = $entries.get_c1px32_k$(it).end_1;
      return tmp0_elvis_lhs == null ? Infinity : tmp0_elvis_lhs;
    };
  }
  function StreamingGuide(requested, clock, programmeLimit, perChannel) {
    this.requested_1 = requested;
    this.clock_1 = clock;
    this.programmeLimit_1 = programmeLimit;
    this.perChannel_1 = perChannel;
    var tmp = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp.idDepths_1 = LinkedHashMap_init_$Create$();
    var tmp_0 = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp_0.nameDepths_1 = LinkedHashMap_init_$Create$();
    var tmp_1 = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp_1.aliasDepths_1 = LinkedHashMap_init_$Create$();
    var tmp_2 = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    tmp_2.candidateDepths_1 = LinkedHashMap_init_$Create$();
    var tmp_3 = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp_3.metadata_1 = LinkedHashMap_init_$Create$();
    var tmp_4 = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    tmp_4.aliases_1 = LinkedHashMap_init_$Create$();
    var tmp_5 = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    tmp_5.canonicalAliases_1 = LinkedHashMap_init_$Create$();
    var tmp_6 = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    tmp_6.programmes_1 = LinkedHashMap_init_$Create$();
    var tmp_7 = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    tmp_7.nextCandidates_1 = LinkedHashMap_init_$Create$();
    var tmp_8 = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    tmp_8.nextEntries_1 = LinkedHashMap_init_$Create$();
    var tmp_9 = this;
    // Inline function 'kotlin.collections.mutableSetOf' call
    tmp_9.truncated_1 = LinkedHashSet_init_$Create$();
    this.programmeCount_1 = 0;
    this.programmeCap_1 = this.perChannel_1;
    var tmp_10 = this;
    var tmp0 = this.requested_1;
    var tmp$ret$11;
    $l$block: {
      // Inline function 'kotlin.collections.maxOfOrNull' call
      var iterator = tmp0.iterator_jk1svi_k$();
      if (!iterator.hasNext_bitz1p_k$()) {
        tmp$ret$11 = null;
        break $l$block;
      }
      var maxValue = iterator.next_20eer_k$().days_1;
      while (iterator.hasNext_bitz1p_k$()) {
        var v = iterator.next_20eer_k$().days_1;
        // Inline function 'kotlin.comparisons.maxOf' call
        var a = maxValue;
        maxValue = Math.max(a, v);
      }
      tmp$ret$11 = maxValue;
    }
    var tmp0_elvis_lhs = tmp$ret$11;
    tmp_10.startWindow_1 = this.clock_1 - (tmp0_elvis_lhs == null ? 1.0 : tmp0_elvis_lhs) * 86400;
    this.endWindow_1 = this.clock_1 + 86400;
    var _iterator__ex2g4s = this.requested_1.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var row = _iterator__ex2g4s.next_20eer_k$();
      retainDepth(this, this.idDepths_1, row.id_1, row.days_1);
      var _iterator__ex2g4s_0 = row.get_names_ivn21r_k$().iterator_jk1svi_k$();
      while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
        var name = _iterator__ex2g4s_0.next_20eer_k$();
        retainDepth(this, this.nameDepths_1, name, row.days_1);
        retainDepth(this, this.aliasDepths_1, GuideNames_instance.canonical_yvzfne_k$(name), row.days_1);
      }
    }
    this.candidateCount_1 = this.idDepths_1.get_size_woubt6_k$();
  }
  protoOf(StreamingGuide).channel_c4n2uz_k$ = function (id, names, icon) {
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(names, 10));
    var _iterator__ex2g4s = names.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = GuideNames_instance.normalized_qcj5er_k$(item);
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    // Inline function 'kotlin.collections.filter' call
    // Inline function 'kotlin.collections.filterTo' call
    var destination_0 = ArrayList_init_$Create$();
    var _iterator__ex2g4s_0 = destination.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s_0.next_20eer_k$();
      // Inline function 'kotlin.collections.contains' call
      // Inline function 'kotlin.collections.containsKey' call
      var this_0 = this.nameDepths_1;
      if ((isInterface(this_0, KtMap) ? this_0 : THROW_CCE()).containsKey_aw81wo_k$(element)) {
        destination_0.add_utx5q5_k$(element);
      }
    }
    var matches = destination_0;
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination_1 = ArrayList_init_$Create$_0(collectionSizeOrDefault(names, 10));
    var _iterator__ex2g4s_1 = names.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
      var item_0 = _iterator__ex2g4s_1.next_20eer_k$();
      var tmp$ret$10 = GuideNames_instance.canonical_yvzfne_k$(item_0);
      destination_1.add_utx5q5_k$(tmp$ret$10);
    }
    // Inline function 'kotlin.collections.filter' call
    // Inline function 'kotlin.collections.filterTo' call
    var destination_2 = ArrayList_init_$Create$();
    var _iterator__ex2g4s_2 = destination_1.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
      var element_0 = _iterator__ex2g4s_2.next_20eer_k$();
      // Inline function 'kotlin.collections.contains' call
      // Inline function 'kotlin.collections.containsKey' call
      var this_1 = this.aliasDepths_1;
      if ((isInterface(this_1, KtMap) ? this_1 : THROW_CCE()).containsKey_aw81wo_k$(element_0)) {
        destination_2.add_utx5q5_k$(element_0);
      }
    }
    var canonicalMatches = destination_2;
    var tmp;
    var tmp_0;
    // Inline function 'kotlin.collections.contains' call
    // Inline function 'kotlin.collections.containsKey' call
    var this_2 = this.idDepths_1;
    if (!(isInterface(this_2, KtMap) ? this_2 : THROW_CCE()).containsKey_aw81wo_k$(id)) {
      tmp_0 = matches.isEmpty_y1axqb_k$();
    } else {
      tmp_0 = false;
    }
    if (tmp_0) {
      tmp = canonicalMatches.isEmpty_y1axqb_k$();
    } else {
      tmp = false;
    }
    if (tmp)
      return true;
    var tmp_1;
    if (this.metadata_1.get_size_woubt6_k$() >= 16384) {
      // Inline function 'kotlin.collections.contains' call
      // Inline function 'kotlin.collections.containsKey' call
      var this_3 = this.metadata_1;
      tmp_1 = !(isInterface(this_3, KtMap) ? this_3 : THROW_CCE()).containsKey_aw81wo_k$(id);
    } else {
      tmp_1 = false;
    }
    if (tmp_1)
      return false;
    var tmp0_elvis_lhs = this.idDepths_1.get_wei43m_k$(id);
    var days = tmp0_elvis_lhs == null ? 1.0 : tmp0_elvis_lhs;
    var _iterator__ex2g4s_3 = matches.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_3.hasNext_bitz1p_k$()) {
      var name = _iterator__ex2g4s_3.next_20eer_k$();
      var tmp0 = days;
      var tmp1_elvis_lhs = this.nameDepths_1.get_wei43m_k$(name);
      // Inline function 'kotlin.comparisons.maxOf' call
      var b = tmp1_elvis_lhs == null ? 1.0 : tmp1_elvis_lhs;
      days = Math.max(tmp0, b);
    }
    var _iterator__ex2g4s_4 = canonicalMatches.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_4.hasNext_bitz1p_k$()) {
      var name_0 = _iterator__ex2g4s_4.next_20eer_k$();
      var tmp0_0 = days;
      var tmp2_elvis_lhs = this.aliasDepths_1.get_wei43m_k$(name_0);
      // Inline function 'kotlin.comparisons.maxOf' call
      var b_0 = tmp2_elvis_lhs == null ? 1.0 : tmp2_elvis_lhs;
      days = Math.max(tmp0_0, b_0);
    }
    retainDepth(this, this.candidateDepths_1, id, days);
    var previous = this.metadata_1.get_wei43m_k$(id);
    if (previous == null) {
      var tmp0_1 = this.metadata_1;
      // Inline function 'kotlin.collections.set' call
      var value = new GuideStation(id, toMutableList(names), icon);
      tmp0_1.put_4fpzoq_k$(id, value);
      // Inline function 'kotlin.collections.contains' call
      // Inline function 'kotlin.collections.containsKey' call
      var this_4 = this.idDepths_1;
      if (!(isInterface(this_4, KtMap) ? this_4 : THROW_CCE()).containsKey_aw81wo_k$(id)) {
        this.candidateCount_1 = this.candidateCount_1 + 1 | 0;
      }
    } else {
      var combined = distinct(plus(previous.names_1, names));
      previous.names_1.clear_j9egeb_k$();
      previous.names_1.addAll_h3ej1q_k$(combined);
      // Inline function 'kotlin.text.isEmpty' call
      var this_5 = previous.logo_1;
      if (charSequenceLength(this_5) === 0)
        previous.logo_1 = icon;
    }
    var _iterator__ex2g4s_5 = matches.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_5.hasNext_bitz1p_k$()) {
      var name_1 = _iterator__ex2g4s_5.next_20eer_k$();
      // Inline function 'kotlin.collections.getOrPut' call
      var this_6 = this.aliases_1;
      var value_0 = this_6.get_wei43m_k$(name_1);
      var tmp_2;
      if (value_0 == null) {
        // Inline function 'kotlin.collections.linkedSetOf' call
        var answer = LinkedHashSet_init_$Create$();
        this_6.put_4fpzoq_k$(name_1, answer);
        tmp_2 = answer;
      } else {
        tmp_2 = value_0;
      }
      tmp_2.add_utx5q5_k$(id);
    }
    var _iterator__ex2g4s_6 = canonicalMatches.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_6.hasNext_bitz1p_k$()) {
      var name_2 = _iterator__ex2g4s_6.next_20eer_k$();
      // Inline function 'kotlin.collections.getOrPut' call
      var this_7 = this.canonicalAliases_1;
      var value_1 = this_7.get_wei43m_k$(name_2);
      var tmp_3;
      if (value_1 == null) {
        // Inline function 'kotlin.collections.linkedSetOf' call
        var answer_0 = LinkedHashSet_init_$Create$();
        this_7.put_4fpzoq_k$(name_2, answer_0);
        tmp_3 = answer_0;
      } else {
        tmp_3 = value_1;
      }
      tmp_3.add_utx5q5_k$(id);
    }
    return true;
  };
  protoOf(StreamingGuide).accepts_pt7gjr_k$ = function (id, start, end) {
    var tmp0_elvis_lhs = this.idDepths_1.get_wei43m_k$(id);
    var tmp0 = tmp0_elvis_lhs == null ? 1.0 : tmp0_elvis_lhs;
    var tmp1_elvis_lhs = this.candidateDepths_1.get_wei43m_k$(id);
    // Inline function 'kotlin.comparisons.maxOf' call
    var b = tmp1_elvis_lhs == null ? 1.0 : tmp1_elvis_lhs;
    var tmp$ret$0 = Math.max(tmp0, b);
    var lower = this.clock_1 - tmp$ret$0 * 86400;
    var tmp;
    if (!(start == null) && start < this.endWindow_1 && (end == null ? start >= lower : end > lower && end > start)) {
      var tmp_0;
      // Inline function 'kotlin.collections.contains' call
      // Inline function 'kotlin.collections.containsKey' call
      var this_0 = this.idDepths_1;
      if ((isInterface(this_0, KtMap) ? this_0 : THROW_CCE()).containsKey_aw81wo_k$(id)) {
        tmp_0 = true;
      } else {
        // Inline function 'kotlin.collections.contains' call
        // Inline function 'kotlin.collections.containsKey' call
        var this_1 = this.metadata_1;
        tmp_0 = (isInterface(this_1, KtMap) ? this_1 : THROW_CCE()).containsKey_aw81wo_k$(id);
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(StreamingGuide).programme_4t147i_k$ = function (id, start, end, payload) {
    var tmp = this;
    var tmp0 = this.programmeCap_1;
    var tmp2 = this.candidateCount_1;
    // Inline function 'kotlin.comparisons.maxOf' call
    var c = this.requested_1.get_size_woubt6_k$();
    var tmp$ret$0 = Math.max(1, tmp2, c);
    // Inline function 'kotlin.math.floor' call
    var x = this.programmeLimit_1 / tmp$ret$0;
    // Inline function 'kotlin.comparisons.minOf' call
    var b = Math.floor(x);
    // Inline function 'kotlin.comparisons.maxOf' call
    var b_0 = Math.min(tmp0, b);
    tmp.programmeCap_1 = Math.max(1.0, b_0);
    // Inline function 'kotlin.collections.getOrPut' call
    var this_0 = this.programmes_1;
    var value = this_0.get_wei43m_k$(id);
    var tmp_0;
    if (value == null) {
      // Inline function 'kotlin.collections.mutableListOf' call
      var answer = ArrayList_init_$Create$();
      this_0.put_4fpzoq_k$(id, answer);
      tmp_0 = answer;
    } else {
      tmp_0 = value;
    }
    var entries = tmp_0;
    var item = new Entry_0(id, start, end, payload);
    if (start > this.clock_1 && (this.nextCandidates_1.get_wei43m_k$(id) == null || start < getValue(this.nextCandidates_1, id).start_1)) {
      var tmp0_0 = this.nextCandidates_1;
      // Inline function 'kotlin.collections.set' call
      var value_0 = new Entry_0(id, start, end, Unit_instance);
      tmp0_0.put_4fpzoq_k$(id, value_0);
      // Inline function 'kotlin.collections.set' call
      this.nextEntries_1.put_4fpzoq_k$(id, item);
      // Inline function 'kotlin.comparisons.compareBy' call
      var tmp_1 = StreamingGuide$programme$lambda(this);
      var tmp$ret$9 = new sam$kotlin_Comparator$0_4(tmp_1);
      sortWith_0(entries, tmp$ret$9);
    }
    var score = priority(this, item);
    if (entries.get_size_woubt6_k$() >= this.programmeCap_1) {
      this.truncated_1.add_utx5q5_k$(id);
      if (score >= priority(this, last(entries))) {
        if (this.nextEntries_1.get_wei43m_k$(id) === item) {
          this.nextEntries_1.remove_gppy8k_k$(id);
        }
        return Unit_instance;
      }
      var removed = entries.removeAt_6niowx_k$(get_lastIndex_0(entries));
      if (this.nextEntries_1.get_wei43m_k$(id) === removed) {
        this.nextEntries_1.remove_gppy8k_k$(id);
      }
      this.programmeCount_1 = this.programmeCount_1 - 1 | 0;
    }
    if (this.programmeCount_1 >= this.programmeLimit_1) {
      this.truncated_1.add_utx5q5_k$(id);
      if (this.nextEntries_1.get_wei43m_k$(id) === item) {
        this.nextEntries_1.remove_gppy8k_k$(id);
      }
      return Unit_instance;
    }
    var low = 0;
    var high = entries.get_size_woubt6_k$();
    while (low < high) {
      var middle = (low + high | 0) >>> 1 | 0;
      if (priority(this, entries.get_c1px32_k$(middle)) <= score)
        low = middle + 1 | 0;
      else
        high = middle;
    }
    entries.add_dl6gt3_k$(low, item);
    this.programmeCount_1 = this.programmeCount_1 + 1 | 0;
  };
  protoOf(StreamingGuide).output_ll6xq7_k$ = function (limit, channel, programme, bytes, emit) {
    // Inline function 'kotlin.collections.linkedMapOf' call
    var selected = LinkedHashMap_init_$Create$();
    var _iterator__ex2g4s = this.requested_1.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var row = _iterator__ex2g4s.next_20eer_k$();
      var tmp = GuideNames_instance;
      var tmp_0;
      var tmp_1;
      // Inline function 'kotlin.text.isNotEmpty' call
      var this_0 = row.id_1;
      if (charSequenceLength(this_0) > 0) {
        var tmp_2;
        var tmp0 = this.metadata_1;
        // Inline function 'kotlin.collections.contains' call
        // Inline function 'kotlin.collections.containsKey' call
        var key = row.id_1;
        if ((isInterface(tmp0, KtMap) ? tmp0 : THROW_CCE()).containsKey_aw81wo_k$(key)) {
          tmp_2 = true;
        } else {
          var tmp0_0 = this.programmes_1;
          // Inline function 'kotlin.collections.contains' call
          // Inline function 'kotlin.collections.containsKey' call
          var key_0 = row.id_1;
          tmp_2 = (isInterface(tmp0_0, KtMap) ? tmp0_0 : THROW_CCE()).containsKey_aw81wo_k$(key_0);
        }
        tmp_1 = tmp_2;
      } else {
        tmp_1 = false;
      }
      if (tmp_1) {
        tmp_0 = listOf(row.id_1);
      } else {
        tmp_0 = emptyList();
      }
      var tmp_3 = tmp_0;
      // Inline function 'kotlin.collections.map' call
      var this_1 = row.get_names_ivn21r_k$();
      // Inline function 'kotlin.collections.mapTo' call
      var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_1, 10));
      var _iterator__ex2g4s_0 = this_1.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
        var item = _iterator__ex2g4s_0.next_20eer_k$();
        var tmp0_safe_receiver = this.aliases_1.get_wei43m_k$(item);
        // Inline function 'kotlin.collections.orEmpty' call
        var tmp0_elvis_lhs = tmp0_safe_receiver == null ? null : toList_0(tmp0_safe_receiver);
        var tmp$ret$8 = tmp0_elvis_lhs == null ? emptyList() : tmp0_elvis_lhs;
        destination.add_utx5q5_k$(tmp$ret$8);
      }
      var tmp_4 = destination;
      // Inline function 'kotlin.collections.map' call
      var this_2 = row.get_names_ivn21r_k$();
      // Inline function 'kotlin.collections.mapTo' call
      var destination_0 = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_2, 10));
      var _iterator__ex2g4s_1 = this_2.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
        var item_0 = _iterator__ex2g4s_1.next_20eer_k$();
        var tmp0_safe_receiver_0 = this.canonicalAliases_1.get_wei43m_k$(GuideNames_instance.canonical_yvzfne_k$(item_0));
        // Inline function 'kotlin.collections.orEmpty' call
        var tmp0_elvis_lhs_0 = tmp0_safe_receiver_0 == null ? null : toList_0(tmp0_safe_receiver_0);
        var tmp$ret$12 = tmp0_elvis_lhs_0 == null ? emptyList() : tmp0_elvis_lhs_0;
        destination_0.add_utx5q5_k$(tmp$ret$12);
      }
      var id = tmp.chooseOrdered_naq0mk_k$(tmp_3, tmp_4, destination_0);
      if (!(id == null)) {
        var tmp0_elvis_lhs_1 = selected.get_wei43m_k$(id);
        var tmp0_1 = tmp0_elvis_lhs_1 == null ? 1.0 : tmp0_elvis_lhs_1;
        // Inline function 'kotlin.comparisons.maxOf' call
        var b = row.days_1;
        // Inline function 'kotlin.collections.set' call
        var value = Math.max(tmp0_1, b);
        selected.put_4fpzoq_k$(id, value);
      }
    }
    var size = 512.0;
    var _iterator__ex2g4s_2 = distinct(plus_0(this.metadata_1.get_keys_wop4xp_k$(), selected.get_keys_wop4xp_k$())).iterator_jk1svi_k$();
    while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
      var id_0 = _iterator__ex2g4s_2.next_20eer_k$();
      var tmp1_elvis_lhs = this.metadata_1.get_wei43m_k$(id_0);
      var fragment = channel(tmp1_elvis_lhs == null ? new GuideStation(id_0) : tmp1_elvis_lhs);
      size = size + bytes(fragment);
      if (size > limit)
        return null;
      emit(fragment);
    }
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination_1 = ArrayList_init_$Create$_0(selected.get_size_woubt6_k$());
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_3 = selected.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_3.hasNext_bitz1p_k$()) {
      var item_1 = _iterator__ex2g4s_3.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var id_1 = item_1.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var days = item_1.get_value_j01efc_k$();
      var lower = this.clock_1 - days * 86400;
      // Inline function 'kotlin.collections.orEmpty' call
      var tmp0_elvis_lhs_2 = this.programmes_1.get_wei43m_k$(id_1);
      // Inline function 'kotlin.collections.filter' call
      var tmp0_2 = tmp0_elvis_lhs_2 == null ? emptyList() : tmp0_elvis_lhs_2;
      // Inline function 'kotlin.collections.filterTo' call
      var destination_2 = ArrayList_init_$Create$();
      var _iterator__ex2g4s_4 = tmp0_2.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_4.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s_4.next_20eer_k$();
        if (element.end_1 == null ? element.start_1 >= lower : element.end_1 > lower) {
          destination_2.add_utx5q5_k$(element);
        }
      }
      var entries = destination_2;
      var tmp_5 = GuideSchedule_instance;
      var tmp_6 = entries.get_size_woubt6_k$();
      var tmp_7 = StreamingGuide$output$lambda(entries);
      var selection = tmp_5.select_mlzbmh_k$(tmp_6, tmp_7, StreamingGuide$output$lambda_0(entries), this.clock_1, true);
      var current = getOrNull_0(entries, selection.current_1);
      var next = getOrNull_0(entries, selection.next_1);
      var tmp_8 = listOfNotNull([current, next]);
      // Inline function 'kotlin.collections.filter' call
      // Inline function 'kotlin.collections.filterTo' call
      var destination_3 = ArrayList_init_$Create$();
      var _iterator__ex2g4s_5 = entries.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_5.hasNext_bitz1p_k$()) {
        var element_0 = _iterator__ex2g4s_5.next_20eer_k$();
        if (!(element_0 === current) && !(element_0 === next)) {
          destination_3.add_utx5q5_k$(element_0);
        }
      }
      var tmp$ret$19 = to(id_1, plus(tmp_8, destination_3));
      destination_1.add_utx5q5_k$(tmp$ret$19);
    }
    var schedules = destination_1;
    var count = 0;
    var round = 0;
    while (round < this.perChannel_1) {
      var _iterator__ex2g4s_6 = schedules.iterator_jk1svi_k$();
      $l$loop_0: while (_iterator__ex2g4s_6.hasNext_bitz1p_k$()) {
        var _destruct__k2r9zo = _iterator__ex2g4s_6.next_20eer_k$();
        var id_2 = _destruct__k2r9zo.component1_7eebsc_k$();
        var entries_0 = _destruct__k2r9zo.component2_7eebsb_k$();
        var tmp2_elvis_lhs = getOrNull_0(entries_0, round);
        var tmp_9;
        if (tmp2_elvis_lhs == null) {
          continue $l$loop_0;
        } else {
          tmp_9 = tmp2_elvis_lhs;
        }
        var entry = tmp_9;
        var fragment_0 = programme(id_2, entry.payload_1);
        var length = bytes(fragment_0);
        if (size + length > limit || count >= this.programmeLimit_1) {
          this.truncated_1.add_utx5q5_k$(id_2);
          continue $l$loop_0;
        }
        size = size + length;
        count = count + 1 | 0;
        emit(fragment_0);
      }
      round = round + 1 | 0;
    }
    // Inline function 'kotlin.math.floor' call
    var x = this.startWindow_1;
    var tmp_10 = Math.floor(x);
    // Inline function 'kotlin.math.floor' call
    var x_0 = this.endWindow_1;
    var tmp_11 = Math.floor(x_0);
    var tmp_12 = this.programmeCap_1;
    var tmp0_3 = this.truncated_1;
    var tmp$ret$31;
    $l$block: {
      // Inline function 'kotlin.collections.count' call
      var tmp_13;
      if (isInterface(tmp0_3, Collection)) {
        tmp_13 = tmp0_3.isEmpty_y1axqb_k$();
      } else {
        tmp_13 = false;
      }
      if (tmp_13) {
        tmp$ret$31 = 0;
        break $l$block;
      }
      var count_0 = 0;
      var _iterator__ex2g4s_7 = tmp0_3.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_7.hasNext_bitz1p_k$()) {
        var element_1 = _iterator__ex2g4s_7.next_20eer_k$();
        // Inline function 'kotlin.collections.contains' call
        // Inline function 'kotlin.collections.containsKey' call
        if ((isInterface(selected, KtMap) ? selected : THROW_CCE()).containsKey_aw81wo_k$(element_1)) {
          count_0 = count_0 + 1 | 0;
          checkCountOverflow(count_0);
        }
      }
      tmp$ret$31 = count_0;
    }
    return new StreamingGuideCoverage(tmp_10, tmp_11, tmp_12, tmp$ret$31);
  };
  var static_init_called_11;
  function static_init_11() {
    if (static_init_called_11)
      return Unit_instance;
    static_init_called_11 = true;
    XmltvRecordFormat_SWIFT_instance = new XmltvRecordFormat('SWIFT', 0);
    XmltvRecordFormat_ARCHIVED_ANDROID_instance = new XmltvRecordFormat('ARCHIVED_ANDROID', 1);
    XmltvRecordFormat_ANDROID_instance = new XmltvRecordFormat('ANDROID', 2);
    XmltvRecordFormat_RUST_instance = new XmltvRecordFormat('RUST', 3);
    XmltvRecordFormat_RUST_NATIVE_instance = new XmltvRecordFormat('RUST_NATIVE', 4);
  }
  var XmltvRecordFormat_SWIFT_instance;
  var XmltvRecordFormat_ARCHIVED_ANDROID_instance;
  var XmltvRecordFormat_ANDROID_instance;
  var XmltvRecordFormat_RUST_instance;
  var XmltvRecordFormat_RUST_NATIVE_instance;
  function XmltvRecordFormat(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function sam$kotlin_Comparator$0_5(function_0) {
    this.function_1 = function_0;
  }
  protoOf(sam$kotlin_Comparator$0_5).compare_bczr_k$ = function (a, b) {
    return this.function_1(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_5).compare = function (a, b) {
    return this.compare_bczr_k$(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_5).getFunctionDelegate_jtodtf_k$ = function () {
    return this.function_1;
  };
  protoOf(sam$kotlin_Comparator$0_5).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, Comparator) : false) {
      var tmp_0;
      if (!(other == null) ? isInterface(other, FunctionAdapter) : false) {
        tmp_0 = equals(this.getFunctionDelegate_jtodtf_k$(), other.getFunctionDelegate_jtodtf_k$());
      } else {
        tmp_0 = false;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(sam$kotlin_Comparator$0_5).hashCode = function () {
    return hashCode_0(this.getFunctionDelegate_jtodtf_k$());
  };
  function NativeRecordRules$order$lambda($starts) {
    return function (a, b) {
      // Inline function 'kotlin.comparisons.compareValuesBy' call
      var tmp = $starts.get_c1px32_k$(a);
      var tmp$ret$2 = $starts.get_c1px32_k$(b);
      return compareValues(tmp, tmp$ret$2);
    };
  }
  function NativeRecordRules() {
  }
  protoOf(NativeRecordRules).order_ew65tb_k$ = function (starts, format) {
    var tmp;
    if (format.equals(XmltvRecordFormat_RUST_getInstance()) || format.equals(XmltvRecordFormat_ANDROID_getInstance())) {
      tmp = toList_0(get_indices(starts));
    } else {
      // Inline function 'kotlin.collections.sortedBy' call
      var this_0 = get_indices(starts);
      // Inline function 'kotlin.comparisons.compareBy' call
      var tmp_0 = NativeRecordRules$order$lambda(starts);
      var tmp$ret$1 = new sam$kotlin_Comparator$0_5(tmp_0);
      tmp = sortedWith(this_0, tmp$ret$1);
    }
    return tmp;
  };
  var NativeRecordRules_instance;
  function NativeRecordRules_getInstance() {
    return NativeRecordRules_instance;
  }
  function Time(epoch, encoded) {
    this.epoch_1 = epoch;
    this.encoded_1 = encoded;
  }
  protoOf(Time).toString = function () {
    return 'Time(epoch=' + toString_0(this.epoch_1) + ', encoded=' + this.encoded_1 + ')';
  };
  protoOf(Time).hashCode = function () {
    var result = this.epoch_1 == null ? 0 : this.epoch_1.hashCode();
    result = imul(result, 31) + getStringHashCode(this.encoded_1) | 0;
    return result;
  };
  protoOf(Time).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof Time))
      return false;
    if (!equals(this.epoch_1, other.epoch_1))
      return false;
    if (!(this.encoded_1 === other.encoded_1))
      return false;
    return true;
  };
  function time($this, value) {
    var tmp0_safe_receiver = $this.encodedTimes_1.get_wei43m_k$(value);
    if (tmp0_safe_receiver == null)
      null;
    else {
      // Inline function 'kotlin.let' call
      return tmp0_safe_receiver;
    }
    var tmp;
    if ($this.android_1) {
      tmp = GuideTime_getInstance().parse_yvvfo7_k$(value, GuideTimeFormat_ANDROID_getInstance());
    } else {
      // Inline function 'kotlin.let' call
      var it = $this.clock_1.seconds_rbj0rf_k$(value);
      tmp = $this.format_1.equals(XmltvRecordFormat_ARCHIVED_ANDROID_getInstance()) ? fromInt(numberToInt(it)) : numberToLong(it);
    }
    var epoch = tmp;
    var result = new Time(epoch, toString_0(epoch));
    if (value.length <= 64) {
      var tmp1_safe_receiver = $this.encodedKeys_1[$this.encodedCursor_1];
      if (tmp1_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        $this.encodedTimes_1.remove_gppy8k_k$(tmp1_safe_receiver);
      }
      $this.encodedKeys_1[$this.encodedCursor_1] = value;
      $this.encodedCursor_1 = ($this.encodedCursor_1 + 1 | 0) % $this.encodedKeys_1.length | 0;
      // Inline function 'kotlin.collections.set' call
      $this.encodedTimes_1.put_4fpzoq_k$(value, result);
    }
    return result;
  }
  function firstName($this, id, name) {
    if ($this.knownChannels_1.add_utx5q5_k$($this.identity_1(id))) {
      $this.actions_1.add_utx5q5_k$(listOf_0(['channel', id, name]));
    }
  }
  function XmltvRecords$_init_$lambda_2qmrqa(it) {
    // Inline function 'kotlin.text.trim' call
    return toString_1(trim(isCharSequence(it) ? it : THROW_CCE()));
  }
  function XmltvRecords$_init_$lambda_2qmrqa_0(it) {
    return it;
  }
  function XmltvRecords(format, trim, identity) {
    var tmp;
    if (trim === VOID) {
      tmp = XmltvRecords$_init_$lambda_2qmrqa;
    } else {
      tmp = trim;
    }
    trim = tmp;
    var tmp_0;
    if (identity === VOID) {
      tmp_0 = XmltvRecords$_init_$lambda_2qmrqa_0;
    } else {
      tmp_0 = identity;
    }
    identity = tmp_0;
    this.format_1 = format;
    this.trim_1 = trim;
    this.identity_1 = identity;
    this.rust_1 = this.format_1.equals(XmltvRecordFormat_RUST_getInstance()) || this.format_1.equals(XmltvRecordFormat_RUST_NATIVE_getInstance());
    this.android_1 = this.format_1.equals(XmltvRecordFormat_ANDROID_getInstance());
    var tmp_1 = this;
    var tmp0 = this.format_1.ordinal_1;
    tmp_1.clock_1 = new NativeGuideClock(tmp0 === 0 ? NativeGuideFormat_SWIFT_getInstance() : tmp0 === 1 ? NativeGuideFormat_ARCHIVED_ANDROID_getInstance() : NativeGuideFormat_RUST_getInstance());
    var tmp_2 = this;
    // Inline function 'kotlin.collections.mutableSetOf' call
    tmp_2.knownChannels_1 = LinkedHashSet_init_$Create$();
    this.channel_1 = null;
    this.channelName_1 = '';
    this.channelIcon_1 = '';
    var tmp_3 = this;
    // Inline function 'kotlin.collections.mutableListOf' call
    tmp_3.aliases_1 = ArrayList_init_$Create$();
    this.programme_1 = null;
    this.from_1 = null;
    this.to_1 = null;
    var tmp_4 = this;
    // Inline function 'kotlin.collections.mutableMapOf' call
    tmp_4.encodedTimes_1 = LinkedHashMap_init_$Create$();
    var tmp_5 = this;
    // Inline function 'kotlin.arrayOfNulls' call
    tmp_5.encodedKeys_1 = Array(4096);
    this.encodedCursor_1 = 0;
    this.title_1 = StringBuilder_init_$Create$_0();
    this.description_1 = StringBuilder_init_$Create$_0();
    this.programmeIcon_1 = '';
    this.field_1 = null;
    this.text_1 = StringBuilder_init_$Create$_0();
    var tmp_6 = this;
    // Inline function 'kotlin.collections.mutableListOf' call
    tmp_6.actions_1 = ArrayList_init_$Create$();
    this.failed_1 = false;
  }
  protoOf(XmltvRecords).startDecoded_6ledwt_k$ = function (name, id, programmeId, start, stop, icon) {
    if (this.failed_1)
      return Unit_instance;
    switch (name) {
      case 'channel':
        if (!this.android_1) {
          var tmp = this;
          var tmp_0;
          if (this.rust_1) {
            // Inline function 'kotlin.text.orEmpty' call
            tmp_0 = id == null ? '' : id;
          } else {
            tmp_0 = id;
          }
          tmp.channel_1 = tmp_0;
          if (this.rust_1) {
            this.channelName_1 = '';
            this.channelIcon_1 = '';
            var tmp_1 = this;
            // Inline function 'kotlin.collections.mutableListOf' call
            tmp_1.aliases_1 = ArrayList_init_$Create$();
          }
        }

        break;
      case 'programme':
        var tmp_2 = this;
        var tmp_3;
        if (this.android_1) {
          // Inline function 'kotlin.text.orEmpty' call
          var tmp$ret$2 = programmeId == null ? '' : programmeId;
          tmp_3 = this.trim_1(tmp$ret$2);
        } else if (this.rust_1) {
          // Inline function 'kotlin.text.orEmpty' call
          tmp_3 = programmeId == null ? '' : programmeId;
        } else {
          tmp_3 = programmeId;
        }

        tmp_2.programme_1 = tmp_3;
        var tmp_4 = this;
        // Inline function 'kotlin.text.orEmpty' call

        var tmp$ret$4 = start == null ? '' : start;
        tmp_4.from_1 = time(this, tmp$ret$4);
        var tmp_5 = this;
        // Inline function 'kotlin.text.orEmpty' call

        var tmp$ret$5 = stop == null ? '' : stop;
        tmp_5.to_1 = time(this, tmp$ret$5);
        this.title_1.clear_1keqml_k$();
        this.description_1.clear_1keqml_k$();
        this.programmeIcon_1 = '';
        if (this.android_1)
          this.field_1 = null;
        break;
      case 'display-name':
        if (!this.android_1 && !(this.channel_1 == null)) {
          this.text_1.clear_1keqml_k$();
          this.field_1 = 'display-name';
        }

        break;
      case 'title':
      case 'desc':
        if (!(this.programme_1 == null)) {
          this.field_1 = name;
          if (this.rust_1 || this.android_1) {
            this.text_1.clear_1keqml_k$();
          }
        }

        break;
      case 'icon':
        if (!this.android_1) {
          if (this.rust_1) {
            if (icon == null)
              null;
            else {
              // Inline function 'kotlin.let' call
              if (!(this.channel_1 == null))
                this.channelIcon_1 = icon;
              else if (!(this.programme_1 == null))
                this.programmeIcon_1 = icon;
            }
          } else {
            var tmp2_safe_receiver = this.channel_1;
            if (tmp2_safe_receiver == null)
              null;
            else {
              // Inline function 'kotlin.let' call
              var tmp_6 = this.actions_1;
              // Inline function 'kotlin.text.orEmpty' call
              var tmp$ret$10 = icon == null ? '' : icon;
              tmp_6.add_utx5q5_k$(listOf_0(['icon', tmp2_safe_receiver, tmp$ret$10]));
            }
          }
        }

        break;
    }
  };
  protoOf(XmltvRecords).text_x72pul_k$ = function (value) {
    if (this.failed_1 || this.field_1 == null)
      return Unit_instance;
    if (this.rust_1 || this.android_1 || this.field_1 === 'display-name')
      this.text_1.append_22ad7x_k$(value);
    else if (this.field_1 === 'title')
      this.title_1.append_22ad7x_k$(value);
    else
      this.description_1.append_22ad7x_k$(value);
  };
  protoOf(XmltvRecords).textError_gkacxb_k$ = function (index) {
    if (!this.failed_1 && !(this.field_1 == null)) {
      this.actions_1.add_utx5q5_k$(listOf_0(['error', index]));
      this.failed_1 = true;
    }
  };
  protoOf(XmltvRecords).end_laoys1_k$ = function (name) {
    if (this.failed_1)
      return Unit_instance;
    if (this.android_1) {
      if (name === this.field_1) {
        if (name === 'title' && isBlank(this.title_1)) {
          this.title_1.clear_1keqml_k$();
          this.title_1.append_22ad7x_k$(this.trim_1(this.text_1.toString()));
        }
        if (name === 'desc' && isBlank(this.description_1)) {
          this.description_1.clear_1keqml_k$();
          this.description_1.append_22ad7x_k$(this.trim_1(this.text_1.toString()));
        }
        this.field_1 = null;
      }
      if (name === 'programme') {
        // Inline function 'kotlin.text.orEmpty' call
        var tmp0_elvis_lhs = this.programme_1;
        var id = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
        var tmp = GuideProgrammeRules_instance;
        var tmp0_safe_receiver = this.from_1;
        var tmp_0 = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.epoch_1;
        var tmp1_safe_receiver = this.to_1;
        if (tmp.validAndroid_h230qr_k$(id, tmp_0, tmp1_safe_receiver == null ? null : tmp1_safe_receiver.epoch_1)) {
          var tmp_1 = this.actions_1;
          var tmp_2 = ensureNotNull(this.from_1).encoded_1;
          var tmp_3 = ensureNotNull(this.to_1).encoded_1;
          // Inline function 'kotlin.text.ifBlank' call
          var this_0 = this.title_1.toString();
          var tmp_4;
          if (isBlank(this_0)) {
            tmp_4 = 'Untitled programme';
          } else {
            tmp_4 = this_0;
          }
          var tmp$ret$1 = tmp_4;
          tmp_1.add_utx5q5_k$(listOf_0(['programme', id, tmp_2, tmp_3, tmp$ret$1, this.description_1.toString(), '']));
        }
        this.programme_1 = null;
      }
      return Unit_instance;
    }
    switch (name) {
      case 'display-name':
      case 'title':
      case 'desc':
        if (this.rust_1) {
          var value = this.trim_1(this.text_1.toString());
          switch (this.field_1) {
            case 'display-name':
              if (!(this.channel_1 == null)) {
                this.aliases_1.add_utx5q5_k$(value);
                this.channelName_1 = value;
              }

              break;
            case 'title':
              if (!(this.programme_1 == null)) {
                this.title_1.clear_1keqml_k$();
                this.title_1.append_22ad7x_k$(value);
              }

              break;
            case 'desc':
              if (!(this.programme_1 == null)) {
                this.description_1.clear_1keqml_k$();
                this.description_1.append_22ad7x_k$(value);
              }

              break;
          }
          this.text_1.clear_1keqml_k$();
        } else if (name === 'display-name') {
          var tmp4_safe_receiver = this.channel_1;
          if (tmp4_safe_receiver == null)
            null;
          else {
            // Inline function 'kotlin.let' call
            var value_0 = this.trim_1(this.text_1.toString());
            // Inline function 'kotlin.text.isNotEmpty' call
            if (charSequenceLength(value_0) > 0) {
              this.actions_1.add_utx5q5_k$(listOf_0(['name', tmp4_safe_receiver, value_0]));
              firstName(this, tmp4_safe_receiver, value_0);
            }
          }
        }

        this.field_1 = null;
        break;
      case 'channel':
        var tmp5_safe_receiver = this.channel_1;
        if (tmp5_safe_receiver == null)
          null;
        else {
          // Inline function 'kotlin.let' call
          var tmp_5;
          if (this.rust_1) {
            var tmp_6 = this.actions_1;
            // Inline function 'kotlin.text.ifEmpty' call
            var this_1 = this.channelName_1;
            var tmp_7;
            // Inline function 'kotlin.text.isEmpty' call
            if (charSequenceLength(this_1) === 0) {
              tmp_7 = tmp5_safe_receiver;
            } else {
              tmp_7 = this_1;
            }
            var tmp$ret$8 = tmp_7;
            tmp_5 = tmp_6.add_utx5q5_k$(plus(listOf_0(['replace-channel', tmp5_safe_receiver, tmp$ret$8, this.channelIcon_1]), this.aliases_1));
          } else {
            firstName(this, tmp5_safe_receiver, tmp5_safe_receiver);
            tmp_5 = Unit_instance;
          }
        }

        this.channel_1 = null;
        this.field_1 = null;
        break;
      case 'programme':
        var tmp6_safe_receiver = this.programme_1;
        if (tmp6_safe_receiver == null)
          null;
        else {
          // Inline function 'kotlin.let' call
          var value_1 = this.title_1.toString();
          var tmp_8;
          if (this.format_1.equals(XmltvRecordFormat_ARCHIVED_ANDROID_getInstance())) {
            // Inline function 'kotlin.text.isNotBlank' call
            tmp_8 = !isBlank(value_1);
          } else {
            // Inline function 'kotlin.text.isNotEmpty' call
            tmp_8 = charSequenceLength(value_1) > 0;
          }
          var admitted = tmp_8;
          if (admitted) {
            this.actions_1.add_utx5q5_k$(listOf_0(['programme', tmp6_safe_receiver, ensureNotNull(this.from_1).encoded_1, ensureNotNull(this.to_1).encoded_1, value_1, this.description_1.toString(), this.programmeIcon_1]));
          }
        }

        this.programme_1 = null;
        this.field_1 = null;
        break;
    }
    if (this.rust_1)
      this.field_1 = null;
  };
  protoOf(XmltvRecords).drain_1l2ad4_k$ = function () {
    // Inline function 'kotlin.also' call
    var this_0 = this.actions_1;
    var tmp = this;
    // Inline function 'kotlin.collections.mutableListOf' call
    tmp.actions_1 = ArrayList_init_$Create$();
    return this_0;
  };
  function XmltvRecordFormat_SWIFT_getInstance() {
    static_init_11();
    return XmltvRecordFormat_SWIFT_instance;
  }
  function XmltvRecordFormat_ARCHIVED_ANDROID_getInstance() {
    static_init_11();
    return XmltvRecordFormat_ARCHIVED_ANDROID_instance;
  }
  function XmltvRecordFormat_ANDROID_getInstance() {
    static_init_11();
    return XmltvRecordFormat_ANDROID_instance;
  }
  function XmltvRecordFormat_RUST_getInstance() {
    static_init_11();
    return XmltvRecordFormat_RUST_instance;
  }
  function XmltvRecordFormat_RUST_NATIVE_getInstance() {
    static_init_11();
    return XmltvRecordFormat_RUST_NATIVE_instance;
  }
  function XtreamItem(id, providerId, kind, name, url, group, logo, epgId, description, adult, archiveDays, archiveSource, generatedName, generatedGroup, season, episode) {
    epgId = epgId === VOID ? '' : epgId;
    description = description === VOID ? '' : description;
    adult = adult === VOID ? false : adult;
    archiveDays = archiveDays === VOID ? null : archiveDays;
    archiveSource = archiveSource === VOID ? '' : archiveSource;
    generatedName = generatedName === VOID ? '' : generatedName;
    generatedGroup = generatedGroup === VOID ? false : generatedGroup;
    season = season === VOID ? '' : season;
    episode = episode === VOID ? null : episode;
    this.id_1 = id;
    this.providerId_1 = providerId;
    this.kind_1 = kind;
    this.name_1 = name;
    this.url_1 = url;
    this.group_1 = group;
    this.logo_1 = logo;
    this.epgId_1 = epgId;
    this.description_1 = description;
    this.adult_1 = adult;
    this.archiveDays_1 = archiveDays;
    this.archiveSource_1 = archiveSource;
    this.generatedName_1 = generatedName;
    this.generatedGroup_1 = generatedGroup;
    this.season_1 = season;
    this.episode_1 = episode;
  }
  protoOf(XtreamItem).toString = function () {
    return 'XtreamItem(id=' + this.id_1 + ', providerId=' + this.providerId_1 + ', kind=' + this.kind_1 + ', name=' + this.name_1 + ', url=' + this.url_1 + ', group=' + this.group_1 + ', logo=' + this.logo_1 + ', epgId=' + this.epgId_1 + ', description=' + this.description_1 + ', adult=' + this.adult_1 + ', archiveDays=' + this.archiveDays_1 + ', archiveSource=' + this.archiveSource_1 + ', generatedName=' + this.generatedName_1 + ', generatedGroup=' + this.generatedGroup_1 + ', season=' + this.season_1 + ', episode=' + this.episode_1 + ')';
  };
  protoOf(XtreamItem).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + getStringHashCode(this.providerId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.kind_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.name_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.url_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.group_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.logo_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.epgId_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.description_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.adult_1) | 0;
    result = imul(result, 31) + (this.archiveDays_1 == null ? 0 : getNumberHashCode(this.archiveDays_1)) | 0;
    result = imul(result, 31) + getStringHashCode(this.archiveSource_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.generatedName_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.generatedGroup_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.season_1) | 0;
    result = imul(result, 31) + (this.episode_1 == null ? 0 : getNumberHashCode(this.episode_1)) | 0;
    return result;
  };
  protoOf(XtreamItem).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof XtreamItem))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!(this.providerId_1 === other.providerId_1))
      return false;
    if (!(this.kind_1 === other.kind_1))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    if (!(this.url_1 === other.url_1))
      return false;
    if (!(this.group_1 === other.group_1))
      return false;
    if (!(this.logo_1 === other.logo_1))
      return false;
    if (!(this.epgId_1 === other.epgId_1))
      return false;
    if (!(this.description_1 === other.description_1))
      return false;
    if (!(this.adult_1 === other.adult_1))
      return false;
    if (!equals(this.archiveDays_1, other.archiveDays_1))
      return false;
    if (!(this.archiveSource_1 === other.archiveSource_1))
      return false;
    if (!(this.generatedName_1 === other.generatedName_1))
      return false;
    if (!(this.generatedGroup_1 === other.generatedGroup_1))
      return false;
    if (!(this.season_1 === other.season_1))
      return false;
    if (!equals(this.episode_1, other.episode_1))
      return false;
    return true;
  };
  function XtreamCatalog(entries, warnings) {
    warnings = warnings === VOID ? emptyList() : warnings;
    this.entries_1 = entries;
    this.warnings_1 = warnings;
  }
  protoOf(XtreamCatalog).toString = function () {
    return 'XtreamCatalog(entries=' + toString_1(this.entries_1) + ', warnings=' + toString_1(this.warnings_1) + ')';
  };
  protoOf(XtreamCatalog).hashCode = function () {
    var result = hashCode_0(this.entries_1);
    result = imul(result, 31) + hashCode_0(this.warnings_1) | 0;
    return result;
  };
  protoOf(XtreamCatalog).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof XtreamCatalog))
      return false;
    if (!equals(this.entries_1, other.entries_1))
      return false;
    if (!equals(this.warnings_1, other.warnings_1))
      return false;
    return true;
  };
  function XtreamSeries(entries, names, warnings) {
    this.entries_1 = entries;
    this.names_1 = names;
    this.warnings_1 = warnings;
  }
  protoOf(XtreamSeries).toString = function () {
    return 'XtreamSeries(entries=' + toString_1(this.entries_1) + ', names=' + toString_1(this.names_1) + ', warnings=' + toString_1(this.warnings_1) + ')';
  };
  protoOf(XtreamSeries).hashCode = function () {
    var result = hashCode_0(this.entries_1);
    result = imul(result, 31) + hashCode_0(this.names_1) | 0;
    result = imul(result, 31) + hashCode_0(this.warnings_1) | 0;
    return result;
  };
  protoOf(XtreamSeries).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof XtreamSeries))
      return false;
    if (!equals(this.entries_1, other.entries_1))
      return false;
    if (!equals(this.names_1, other.names_1))
      return false;
    if (!equals(this.warnings_1, other.warnings_1))
      return false;
    return true;
  };
  function XtreamSeriesParent(id, name, logo, description, adult) {
    name = name === VOID ? '' : name;
    logo = logo === VOID ? '' : logo;
    description = description === VOID ? '' : description;
    adult = adult === VOID ? false : adult;
    this.id_1 = id;
    this.name_1 = name;
    this.logo_1 = logo;
    this.description_1 = description;
    this.adult_1 = adult;
  }
  protoOf(XtreamSeriesParent).toString = function () {
    return 'XtreamSeriesParent(id=' + this.id_1 + ', name=' + this.name_1 + ', logo=' + this.logo_1 + ', description=' + this.description_1 + ', adult=' + this.adult_1 + ')';
  };
  protoOf(XtreamSeriesParent).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + getStringHashCode(this.name_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.logo_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.description_1) | 0;
    result = imul(result, 31) + getBooleanHashCode(this.adult_1) | 0;
    return result;
  };
  protoOf(XtreamSeriesParent).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof XtreamSeriesParent))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!(this.name_1 === other.name_1))
      return false;
    if (!(this.logo_1 === other.logo_1))
      return false;
    if (!(this.description_1 === other.description_1))
      return false;
    if (!(this.adult_1 === other.adult_1))
      return false;
    return true;
  };
  function validExtension($this, value, limit) {
    var tmp;
    var containsArg = value.length;
    if (1 <= containsArg ? containsArg <= limit : false) {
      var tmp$ret$0;
      $l$block: {
        // Inline function 'kotlin.text.all' call
        var inductionVariable = 0;
        while (inductionVariable < charSequenceLength(value)) {
          var element = charSequenceGet(value, inductionVariable);
          inductionVariable = inductionVariable + 1 | 0;
          if (!((_Char___init__impl__6a9atx(97) <= element ? element <= _Char___init__impl__6a9atx(122) : false) || (_Char___init__impl__6a9atx(65) <= element ? element <= _Char___init__impl__6a9atx(90) : false) || (_Char___init__impl__6a9atx(48) <= element ? element <= _Char___init__impl__6a9atx(57) : false))) {
            tmp$ret$0 = false;
            break $l$block;
          }
        }
        tmp$ret$0 = true;
      }
      tmp = tmp$ret$0;
    } else {
      tmp = false;
    }
    return tmp;
  }
  function kindAction($this, kind) {
    return kind === 'series' ? 'get_series' : 'get_' + kind + '_streams';
  }
  function identity($this, format, source, kind, id, component, hash) {
    return format.equals(XtreamFormat_BROWSER_getInstance()) ? component(CoreText_getInstance().trim$default_yjecrm_k$(source.id_1)) + (':xtream:' + kind + ':' + id) : hash(listOf_0([source.id_1, kind, id]));
  }
  function sam$kotlin_Comparator$0_6(function_0) {
    this.function_1 = function_0;
  }
  protoOf(sam$kotlin_Comparator$0_6).compare_bczr_k$ = function (a, b) {
    return this.function_1(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_6).compare = function (a, b) {
    return this.compare_bczr_k$(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_6).getFunctionDelegate_jtodtf_k$ = function () {
    return this.function_1;
  };
  protoOf(sam$kotlin_Comparator$0_6).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, Comparator) : false) {
      var tmp_0;
      if (!(other == null) ? isInterface(other, FunctionAdapter) : false) {
        tmp_0 = equals(this.getFunctionDelegate_jtodtf_k$(), other.getFunctionDelegate_jtodtf_k$());
      } else {
        tmp_0 = false;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(sam$kotlin_Comparator$0_6).hashCode = function () {
    return hashCode_0(this.getFunctionDelegate_jtodtf_k$());
  };
  function sam$kotlin_Comparator$0_7(function_0) {
    this.function_1 = function_0;
  }
  protoOf(sam$kotlin_Comparator$0_7).compare_bczr_k$ = function (a, b) {
    return this.function_1(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_7).compare = function (a, b) {
    return this.compare_bczr_k$(a, b);
  };
  protoOf(sam$kotlin_Comparator$0_7).getFunctionDelegate_jtodtf_k$ = function () {
    return this.function_1;
  };
  protoOf(sam$kotlin_Comparator$0_7).equals = function (other) {
    var tmp;
    if (!(other == null) ? isInterface(other, Comparator) : false) {
      var tmp_0;
      if (!(other == null) ? isInterface(other, FunctionAdapter) : false) {
        tmp_0 = equals(this.getFunctionDelegate_jtodtf_k$(), other.getFunctionDelegate_jtodtf_k$());
      } else {
        tmp_0 = false;
      }
      tmp = tmp_0;
    } else {
      tmp = false;
    }
    return tmp;
  };
  protoOf(sam$kotlin_Comparator$0_7).hashCode = function () {
    return hashCode_0(this.getFunctionDelegate_jtodtf_k$());
  };
  function XtreamCatalogs$seasons$lambda(a, b) {
    // Inline function 'kotlin.comparisons.compareValuesBy' call
    var tmp = CoreNumber_instance.javascript_5uxq0d_k$(a.season_1);
    var tmp$ret$2 = CoreNumber_instance.javascript_5uxq0d_k$(b.season_1);
    return compareValues(tmp, tmp$ret$2);
  }
  function XtreamCatalogs$episodes$lambda(a, b) {
    // Inline function 'kotlin.comparisons.compareValuesBy' call
    var tmp0_elvis_lhs = a.episode_1;
    var tmp = tmp0_elvis_lhs == null ? 0.0 : tmp0_elvis_lhs;
    var tmp0_elvis_lhs_0 = b.episode_1;
    var tmp$ret$2 = tmp0_elvis_lhs_0 == null ? 0.0 : tmp0_elvis_lhs_0;
    return compareValues(tmp, tmp$ret$2);
  }
  function XtreamCatalogs$episodes$lambda_0(a, b) {
    // Inline function 'kotlin.comparisons.compareValuesBy' call
    var tmp0_elvis_lhs = toIntOrNull(a.season_1);
    var tmp = tmp0_elvis_lhs == null ? 0 : tmp0_elvis_lhs;
    var tmp0_elvis_lhs_0 = toIntOrNull(b.season_1);
    var tmp$ret$2 = tmp0_elvis_lhs_0 == null ? 0 : tmp0_elvis_lhs_0;
    return compareValues(tmp, tmp$ret$2);
  }
  function XtreamCatalogs$episodes$lambda_1($this) {
    return function (a, b) {
      var previousCompare = $this.compare(a, b);
      var tmp;
      if (!(previousCompare === 0)) {
        tmp = previousCompare;
      } else {
        // Inline function 'kotlin.comparisons.compareValuesBy' call
        var tmp0_elvis_lhs = a.episode_1;
        var tmp_0 = tmp0_elvis_lhs == null ? 0.0 : tmp0_elvis_lhs;
        var tmp0_elvis_lhs_0 = b.episode_1;
        var tmp$ret$2 = tmp0_elvis_lhs_0 == null ? 0.0 : tmp0_elvis_lhs_0;
        tmp = compareValues(tmp_0, tmp$ret$2);
      }
      return tmp;
    };
  }
  function XtreamCatalogs() {
  }
  protoOf(XtreamCatalogs).seriesRequest_ssrwjj_k$ = function (id, folder, format) {
    if (format.equals(XtreamFormat_BROWSER_getInstance()) && (!id.numericId_swg6iw_k$() || !listOf_0(['series', 'season']).contains_aljjnj_k$(folder)))
      throw new XtreamFailure('FOLDER');
    var value = format.equals(XtreamFormat_BROWSER_getInstance()) ? id.string_er2cq7_k$() : id.primitive_uceazd_k$();
    if (format.equals(XtreamFormat_ANDROID_getInstance()) && isBlank(value))
      throw new XtreamFailure('SERIES_ID');
    return new XtreamRequest('get_series_info', mapOf(to('series_id', value)));
  };
  protoOf(XtreamCatalogs).seasons_t15u6m_k$ = function (series, source, parent, component) {
    // Inline function 'kotlin.collections.map' call
    var this_0 = series.entries_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = item.season_1;
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    // Inline function 'kotlin.collections.map' call
    var this_1 = distinct(destination);
    // Inline function 'kotlin.collections.mapTo' call
    var destination_0 = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_1, 10));
    var _iterator__ex2g4s_0 = this_1.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var item_0 = _iterator__ex2g4s_0.next_20eer_k$();
      var tmp = component(CoreText_getInstance().trim$default_yjecrm_k$(source.id_1)) + ':xtream:series:' + parent.id_1 + ':season:' + item_0;
      // Inline function 'kotlin.text.orEmpty' call
      var tmp0_elvis_lhs = series.names_1.get_wei43m_k$(item_0);
      // Inline function 'kotlin.text.ifEmpty' call
      var this_2 = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
      var tmp_0;
      // Inline function 'kotlin.text.isEmpty' call
      if (charSequenceLength(this_2) === 0) {
        tmp_0 = 'Season ' + item_0;
      } else {
        tmp_0 = this_2;
      }
      var tmp$ret$7 = tmp_0;
      var tmp$ret$5 = new XtreamItem(tmp, parent.id_1, 'season', tmp$ret$7, '', parent.name_1, parent.logo_1, VOID, parent.description_1, parent.adult_1, VOID, VOID, VOID, VOID, item_0);
      destination_0.add_utx5q5_k$(tmp$ret$5);
    }
    // Inline function 'kotlin.collections.sortedBy' call
    // Inline function 'kotlin.comparisons.compareBy' call
    var tmp_1 = XtreamCatalogs$seasons$lambda;
    var tmp$ret$11 = new sam$kotlin_Comparator$0_6(tmp_1);
    return sortedWith(destination_0, tmp$ret$11);
  };
  protoOf(XtreamCatalogs).catalog_uygjsh_k$ = function (data, format, source, addresses, resolve, component, hash, kinds, deduplicate) {
    // Inline function 'kotlin.require' call
    // Inline function 'kotlin.require' call
    if (!!format.equals(XtreamFormat_LEGACY_getInstance())) {
      var message = 'Failed requirement.';
      throw IllegalArgumentException_init_$Create$_0(toString_1(message));
    }
    var browser = format.equals(XtreamFormat_BROWSER_getInstance());
    // Inline function 'kotlin.collections.mutableListOf' call
    var entries = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.mutableSetOf' call
    var seen = LinkedHashSet_init_$Create$();
    // Inline function 'kotlin.collections.mutableListOf' call
    var warnings = ArrayList_init_$Create$();
    var _iterator__ex2g4s = kinds.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var kind = _iterator__ex2g4s.next_20eer_k$();
      // Inline function 'kotlin.collections.linkedMapOf' call
      var groups = LinkedHashMap_init_$Create$();
      var tmp0_safe_receiver = data.get_wei43m_k$('get_' + kind + '_categories');
      // Inline function 'kotlin.collections.orEmpty' call
      var tmp0_elvis_lhs = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.elements_1;
      var _iterator__ex2g4s_0 = (tmp0_elvis_lhs == null ? emptyList() : tmp0_elvis_lhs).iterator_jk1svi_k$();
      while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
        var row = _iterator__ex2g4s_0.next_20eer_k$();
        if (browser) {
          if (row.truthy_eb26j6_k$() && row.get_6bo4tg_k$('category_id').get_present_3zxuem_k$()) {
            var tmp2 = row.get_6bo4tg_k$('category_id').string_er2cq7_k$();
            // Inline function 'kotlin.text.ifEmpty' call
            var this_0 = row.get_6bo4tg_k$('category_name').trimmed_hix7di_k$();
            var tmp;
            // Inline function 'kotlin.text.isEmpty' call
            if (charSequenceLength(this_0) === 0) {
              tmp = 'Other';
            } else {
              tmp = this_0;
            }
            // Inline function 'kotlin.collections.set' call
            var value = tmp;
            groups.put_4fpzoq_k$(tmp2, value);
          }
        } else if (row.get_isObject_xg6v9u_k$()) {
          var tmp2_0 = row.get_6bo4tg_k$('category_id').primitive_uceazd_k$();
          // Inline function 'kotlin.collections.set' call
          var value_0 = row.get_6bo4tg_k$('category_name').primitive_uceazd_k$();
          groups.put_4fpzoq_k$(tmp2_0, value_0);
        }
      }
      var tmp1_safe_receiver = data.get_wei43m_k$(kindAction(this, kind));
      // Inline function 'kotlin.collections.orEmpty' call
      var tmp0_elvis_lhs_0 = tmp1_safe_receiver == null ? null : tmp1_safe_receiver.elements_1;
      var _iterator__ex2g4s_1 = (tmp0_elvis_lhs_0 == null ? emptyList() : tmp0_elvis_lhs_0).iterator_jk1svi_k$();
      $l$loop_3: while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
        var row_0 = _iterator__ex2g4s_1.next_20eer_k$();
        if (!browser && !row_0.get_isObject_xg6v9u_k$())
          continue $l$loop_3;
        var value_1 = row_0.get_6bo4tg_k$(kind === 'series' ? 'series_id' : 'stream_id');
        if (browser && !value_1.numericId_swg6iw_k$()) {
          warnings.add_utx5q5_k$('Ignored a catalog record without a numeric stream ID');
          continue $l$loop_3;
        }
        var id = browser ? value_1.string_er2cq7_k$() : value_1.primitive_uceazd_k$();
        if (!browser && isBlank(id))
          continue $l$loop_3;
        var key = identity(this, format, source, kind, id, component, hash);
        if (browser && !seen.add_utx5q5_k$(key))
          continue $l$loop_3;
        var rawName = browser ? row_0.get_6bo4tg_k$('name').trimmed_hix7di_k$() : row_0.get_6bo4tg_k$('name').primitive_uceazd_k$();
        var tmp_0;
        if (browser) {
          // Inline function 'kotlin.text.isEmpty' call
          tmp_0 = charSequenceLength(rawName) === 0;
        } else {
          tmp_0 = isBlank(rawName);
        }
        var generated = tmp_0;
        var name = !generated ? rawName : browser ? (kind === 'series' ? 'Series ' : 'Channel ') + id : 'Untitled ' + kind;
        var category = browser ? row_0.get_6bo4tg_k$('category_id').string_er2cq7_k$() : row_0.get_6bo4tg_k$('category_id').primitive_uceazd_k$();
        // Inline function 'kotlin.text.orEmpty' call
        var tmp0_elvis_lhs_1 = groups.get_wei43m_k$(category);
        var rawGroup = tmp0_elvis_lhs_1 == null ? '' : tmp0_elvis_lhs_1;
        var tmp_1;
        if (browser) {
          // Inline function 'kotlin.text.isEmpty' call
          tmp_1 = charSequenceLength(rawGroup) === 0;
        } else {
          tmp_1 = isBlank(rawGroup);
        }
        var fallbackGroup = tmp_1;
        var group = !fallbackGroup ? rawGroup : browser && !(kind === 'live') ? kind === 'vod' ? 'Movies' : 'Series' : 'Other';
        var tmp_2;
        if (browser) {
          tmp_2 = resolve(row_0.get_6bo4tg_k$('direct_source').trimmed_hix7di_k$());
        } else {
          // Inline function 'kotlin.takeIf' call
          var this_1 = row_0.get_6bo4tg_k$('direct_source').primitive_uceazd_k$();
          var tmp_3;
          // Inline function 'kotlin.text.isNotBlank' call
          if (!isBlank(this_1)) {
            tmp_3 = this_1;
          } else {
            tmp_3 = null;
          }
          var tmp2_safe_receiver = tmp_3;
          var tmp_4;
          if (tmp2_safe_receiver == null) {
            tmp_4 = null;
          } else {
            // Inline function 'kotlin.let' call
            tmp_4 = resolve(tmp2_safe_receiver);
          }
          tmp_2 = tmp_4;
        }
        var direct = tmp_2;
        var candidate = browser && kind === 'live' ? source.output_1 : browser ? row_0.get_6bo4tg_k$('container_extension').trimmed_hix7di_k$() : row_0.get_6bo4tg_k$('container_extension').primitive_uceazd_k$();
        var valid = validExtension(this, candidate, browser ? 10 : 8);
        var tmp_5;
        var tmp_6;
        if (browser && !(kind === 'series')) {
          // Inline function 'kotlin.text.isNullOrEmpty' call
          tmp_6 = direct == null || charSequenceLength(direct) === 0;
        } else {
          tmp_6 = false;
        }
        if (tmp_6) {
          tmp_5 = !valid;
        } else {
          tmp_5 = false;
        }
        if (tmp_5) {
          warnings.add_utx5q5_k$('Ignored VOD without a valid container extension');
          continue $l$loop_3;
        }
        var extension = valid ? candidate : kind === 'live' ? 'm3u8' : 'mp4';
        var tmp_7;
        if (kind === 'series') {
          tmp_7 = '';
        } else if (browser) {
          // Inline function 'kotlin.text.orEmpty' call
          // Inline function 'kotlin.text.ifEmpty' call
          var this_2 = direct == null ? '' : direct;
          var tmp_8;
          // Inline function 'kotlin.text.isEmpty' call
          if (charSequenceLength(this_2) === 0) {
            tmp_8 = addresses.stream_w3koca_k$(kind === 'vod' ? 'movie' : 'live', id, extension);
          } else {
            tmp_8 = this_2;
          }
          tmp_7 = tmp_8;
        } else {
          tmp_7 = direct == null ? addresses.stream_w3koca_k$(kind === 'vod' ? 'movie' : 'live', id, extension) : direct;
        }
        var url = tmp_7;
        var tmp_9;
        if (browser) {
          tmp_9 = row_0.get_6bo4tg_k$('tv_archive_duration').positive_cd8261_k$();
        } else {
          var tmp4_elvis_lhs = toDoubleOrNull(row_0.get_6bo4tg_k$('tv_archive_duration').primitive_uceazd_k$());
          tmp_9 = tmp4_elvis_lhs == null ? 0.0 : tmp4_elvis_lhs;
        }
        var days = tmp_9;
        var archive = kind === 'live' && days > 0 && (browser ? row_0.get_6bo4tg_k$('tv_archive').flag_1vf58_k$() : listOf_0(['1', 'true']).contains_aljjnj_k$(row_0.get_6bo4tg_k$('tv_archive').primitive_uceazd_k$()));
        var tmp_10;
        if (browser) {
          tmp_10 = (row_0.get_6bo4tg_k$('stream_icon').truthy_eb26j6_k$() ? row_0.get_6bo4tg_k$('stream_icon') : row_0.get_6bo4tg_k$('cover')).trimmed_hix7di_k$();
        } else {
          // Inline function 'kotlin.text.ifBlank' call
          var this_3 = row_0.get_6bo4tg_k$('stream_icon').primitive_uceazd_k$();
          var tmp_11;
          if (isBlank(this_3)) {
            tmp_11 = row_0.get_6bo4tg_k$('cover').primitive_uceazd_k$();
          } else {
            tmp_11 = this_3;
          }
          tmp_10 = tmp_11;
        }
        var logo = tmp_10;
        var tmp_12 = resolve(logo);
        var tmp_13;
        if (browser) {
          tmp_13 = row_0.get_6bo4tg_k$('epg_channel_id').trimmed_hix7di_k$();
        } else if (kind === 'live') {
          // Inline function 'kotlin.text.ifBlank' call
          var this_4 = row_0.get_6bo4tg_k$('epg_channel_id').primitive_uceazd_k$();
          var tmp_14;
          if (isBlank(this_4)) {
            tmp_14 = id;
          } else {
            tmp_14 = this_4;
          }
          tmp_13 = tmp_14;
        } else {
          tmp_13 = '';
        }
        entries.add_utx5q5_k$(new XtreamItem(key, id, kind, name, url, group, tmp_12, tmp_13, browser ? row_0.get_6bo4tg_k$('plot').trimmed_hix7di_k$() : row_0.get_6bo4tg_k$('plot').primitive_uceazd_k$(), browser && row_0.get_6bo4tg_k$('is_adult').flag_1vf58_k$(), archive ? days : null, archive && !browser ? addresses.archive_jmizrc_k$(id) : '', generated ? kind : '', fallbackGroup));
        if (!browser && entries.get_size_woubt6_k$() > 100000)
          throw new XtreamFailure('CATALOG_LIMIT');
      }
    }
    var tmp_15;
    if (browser || !deduplicate) {
      tmp_15 = entries;
    } else {
      // Inline function 'kotlin.collections.distinctBy' call
      var set = HashSet_init_$Create$();
      var list = ArrayList_init_$Create$();
      var _iterator__ex2g4s_2 = entries.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
        var e = _iterator__ex2g4s_2.next_20eer_k$();
        var key_0 = e.id_1;
        if (set.add_utx5q5_k$(key_0)) {
          list.add_utx5q5_k$(e);
        }
      }
      tmp_15 = list;
    }
    return new XtreamCatalog(tmp_15, warnings);
  };
  protoOf(XtreamCatalogs).catalog$default_3nmg05_k$ = function (data, format, source, addresses, resolve, component, hash, kinds, deduplicate, $super) {
    kinds = kinds === VOID ? listOf_0(['live', 'vod', 'series']) : kinds;
    deduplicate = deduplicate === VOID ? true : deduplicate;
    return $super === VOID ? this.catalog_uygjsh_k$(data, format, source, addresses, resolve, component, hash, kinds, deduplicate) : $super.catalog_uygjsh_k$.call(this, data, format, source, addresses, resolve, component, hash, kinds, deduplicate);
  };
  protoOf(XtreamCatalogs).episodes_3fcv0q_k$ = function (data, format, source, addresses, parent, resolve, component, hash) {
    var browser = format.equals(XtreamFormat_BROWSER_getInstance());
    if (browser && data.get_6bo4tg_k$('user_info').truthy_eb26j6_k$() && !(data.get_6bo4tg_k$('user_info').get_6bo4tg_k$('auth').string_er2cq7_k$() === '1'))
      throw new XtreamFailure('RESPONSE_AUTH');
    if (!browser && !data.get_isObject_xg6v9u_k$())
      throw new XtreamFailure('SERIES_FORMAT');
    var episodes = data.get_6bo4tg_k$('episodes');
    if (!episodes.get_isObject_xg6v9u_k$() && !episodes.get_isArray_z8qxd2_k$())
      throw new XtreamFailure(browser ? 'BROWSER_SERIES' : 'EPISODES_FORMAT');
    // Inline function 'kotlin.collections.mutableListOf' call
    var warnings = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.linkedMapOf' call
    var names = LinkedHashMap_init_$Create$();
    if (browser) {
      var _iterator__ex2g4s = data.get_6bo4tg_k$('seasons').elements_1.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var season = _iterator__ex2g4s.next_20eer_k$();
        if (season.get_6bo4tg_k$('season_number').numericId_swg6iw_k$()) {
          var tmp2 = season.get_6bo4tg_k$('season_number').string_er2cq7_k$();
          // Inline function 'kotlin.collections.set' call
          var value = season.get_6bo4tg_k$('name').trimmed_hix7di_k$();
          names.put_4fpzoq_k$(tmp2, value);
        }
      }
    }
    var tmp;
    if (episodes.get_isObject_xg6v9u_k$()) {
      tmp = toList_1(episodes.properties_1);
    } else if (browser) {
      // Inline function 'kotlin.collections.mapIndexed' call
      var this_0 = episodes.elements_1;
      // Inline function 'kotlin.collections.mapIndexedTo' call
      var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
      var index = 0;
      var _iterator__ex2g4s_0 = this_0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
        var item = _iterator__ex2g4s_0.next_20eer_k$();
        var _unary__edvuaz = index;
        index = _unary__edvuaz + 1 | 0;
        var index_0 = checkIndexOverflow(_unary__edvuaz);
        var tmp$ret$5 = to(index_0.toString(), item.truthy_eb26j6_k$() && !item.get_isArray_z8qxd2_k$() ? Companion_getInstance_13().array_vqz2lg_k$(listOf(item)) : item);
        destination.add_utx5q5_k$(tmp$ret$5);
      }
      tmp = destination;
    } else {
      tmp = listOf(to('0', episodes));
    }
    var sections = tmp;
    // Inline function 'kotlin.collections.mutableListOf' call
    var result = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.mutableSetOf' call
    var seen = LinkedHashSet_init_$Create$();
    if (browser) {
      // Inline function 'kotlin.collections.filter' call
      // Inline function 'kotlin.collections.filterTo' call
      var destination_0 = ArrayList_init_$Create$();
      var _iterator__ex2g4s_1 = sections.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s_1.next_20eer_k$();
        if (!element.second_1.get_isArray_z8qxd2_k$()) {
          destination_0.add_utx5q5_k$(element);
        }
      }
      // Inline function 'kotlin.collections.forEach' call
      var _iterator__ex2g4s_2 = destination_0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
        var element_0 = _iterator__ex2g4s_2.next_20eer_k$();
        warnings.add_utx5q5_k$('Ignored an invalid episode group');
      }
    }
    var _iterator__ex2g4s_3 = sections.iterator_jk1svi_k$();
    $l$loop: while (_iterator__ex2g4s_3.hasNext_bitz1p_k$()) {
      var _destruct__k2r9zo = _iterator__ex2g4s_3.next_20eer_k$();
      var seasonKey = _destruct__k2r9zo.component1_7eebsc_k$();
      var rows = _destruct__k2r9zo.component2_7eebsb_k$();
      if (!rows.get_isArray_z8qxd2_k$())
        continue $l$loop;
      var _iterator__ex2g4s_4 = rows.elements_1.iterator_jk1svi_k$();
      $l$loop_4: while (_iterator__ex2g4s_4.hasNext_bitz1p_k$()) {
        var row = _iterator__ex2g4s_4.next_20eer_k$();
        if (!browser && !row.get_isObject_xg6v9u_k$())
          continue $l$loop_4;
        var tmp_0;
        if (browser) {
          tmp_0 = row.get_6bo4tg_k$('id').string_er2cq7_k$();
        } else {
          // Inline function 'kotlin.text.ifBlank' call
          var this_1 = row.get_6bo4tg_k$('id').primitive_uceazd_k$();
          var tmp_1;
          if (isBlank(this_1)) {
            tmp_1 = row.get_6bo4tg_k$('stream_id').primitive_uceazd_k$();
          } else {
            tmp_1 = this_1;
          }
          tmp_0 = tmp_1;
        }
        var id = tmp_0;
        var tmp_2;
        if (browser) {
          tmp_2 = row.get_6bo4tg_k$('season').get_present_3zxuem_k$() ? row.get_6bo4tg_k$('season') : Companion_getInstance_13().text_yxj031_k$(seasonKey);
        } else {
          var tmp_3 = Companion_getInstance_13();
          var tmp0_safe_receiver = toIntOrNull(row.get_6bo4tg_k$('season').primitive_uceazd_k$());
          var tmp1_elvis_lhs = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.toString();
          var tmp_4;
          if (tmp1_elvis_lhs == null) {
            var tmp2_safe_receiver = toIntOrNull(seasonKey);
            // Inline function 'kotlin.text.orEmpty' call
            var tmp0_elvis_lhs = tmp2_safe_receiver == null ? null : tmp2_safe_receiver.toString();
            tmp_4 = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
          } else {
            tmp_4 = tmp1_elvis_lhs;
          }
          tmp_2 = tmp_3.text_yxj031_k$(tmp_4);
        }
        var season_0 = tmp_2;
        if (browser && (!row.get_6bo4tg_k$('id').numericId_swg6iw_k$() || !season_0.numericId_swg6iw_k$())) {
          warnings.add_utx5q5_k$('Ignored an episode without a numeric identity or season');
          continue $l$loop_4;
        }
        if (!browser && isBlank(id))
          continue $l$loop_4;
        var tmp_5;
        if (browser) {
          tmp_5 = resolve(row.get_6bo4tg_k$('direct_source').trimmed_hix7di_k$());
        } else {
          // Inline function 'kotlin.takeIf' call
          var this_2 = row.get_6bo4tg_k$('direct_source').primitive_uceazd_k$();
          var tmp_6;
          // Inline function 'kotlin.text.isNotBlank' call
          if (!isBlank(this_2)) {
            tmp_6 = this_2;
          } else {
            tmp_6 = null;
          }
          var tmp3_safe_receiver = tmp_6;
          var tmp_7;
          if (tmp3_safe_receiver == null) {
            tmp_7 = null;
          } else {
            // Inline function 'kotlin.let' call
            tmp_7 = resolve(tmp3_safe_receiver);
          }
          tmp_5 = tmp_7;
        }
        var direct = tmp_5;
        var candidate = browser ? row.get_6bo4tg_k$('container_extension').trimmed_hix7di_k$() : row.get_6bo4tg_k$('container_extension').primitive_uceazd_k$();
        var valid = validExtension(this, candidate, browser ? 10 : 8);
        var tmp_8;
        var tmp_9;
        if (browser) {
          // Inline function 'kotlin.text.isNullOrEmpty' call
          tmp_9 = direct == null || charSequenceLength(direct) === 0;
        } else {
          tmp_9 = false;
        }
        if (tmp_9) {
          tmp_8 = !valid;
        } else {
          tmp_8 = false;
        }
        if (tmp_8) {
          warnings.add_utx5q5_k$('Ignored an episode without a valid container extension');
          continue $l$loop_4;
        }
        if (browser && !seen.add_utx5q5_k$(id))
          continue $l$loop_4;
        var title = browser ? row.get_6bo4tg_k$('title').trimmed_hix7di_k$() : row.get_6bo4tg_k$('title').primitive_uceazd_k$();
        var tmp_10;
        if (browser) {
          // Inline function 'kotlin.text.isEmpty' call
          tmp_10 = charSequenceLength(title) === 0;
        } else {
          tmp_10 = isBlank(title);
        }
        var generated = tmp_10;
        var tmp_11;
        if (browser) {
          tmp_11 = row.get_6bo4tg_k$('episode_num').truthy_eb26j6_k$() ? row.get_6bo4tg_k$('episode_num').string_er2cq7_k$() : id;
        } else {
          // Inline function 'kotlin.text.ifBlank' call
          var this_3 = row.get_6bo4tg_k$('episode_num').primitive_uceazd_k$();
          var tmp_12;
          if (isBlank(this_3)) {
            tmp_12 = id;
          } else {
            tmp_12 = this_3;
          }
          tmp_11 = tmp_12;
        }
        var label = tmp_11;
        var tmp_13;
        if (browser) {
          // Inline function 'kotlin.text.orEmpty' call
          // Inline function 'kotlin.text.ifEmpty' call
          var this_4 = direct == null ? '' : direct;
          var tmp_14;
          // Inline function 'kotlin.text.isEmpty' call
          if (charSequenceLength(this_4) === 0) {
            tmp_14 = addresses.stream_w3koca_k$('series', id, candidate);
          } else {
            tmp_14 = this_4;
          }
          tmp_13 = tmp_14;
        } else {
          tmp_13 = direct == null ? addresses.stream_w3koca_k$('series', id, valid ? candidate : 'mp4') : direct;
        }
        var url = tmp_13;
        var tmp_15 = identity(this, format, source, 'episode', id, component, hash);
        var tmp_16 = generated ? 'Episode ' + label : title;
        var tmp_17;
        if (browser) {
          // Inline function 'kotlin.text.ifEmpty' call
          var this_5 = parent.name_1;
          var tmp_18;
          // Inline function 'kotlin.text.isEmpty' call
          if (charSequenceLength(this_5) === 0) {
            tmp_18 = 'Series';
          } else {
            tmp_18 = this_5;
          }
          tmp_17 = tmp_18;
        } else {
          tmp_17 = parent.name_1;
        }
        var tmp_19 = tmp_17;
        // Inline function 'kotlin.text.ifEmpty' call
        var this_6 = resolve(browser ? row.get_6bo4tg_k$('info').get_6bo4tg_k$('movie_image').trimmed_hix7di_k$() : row.get_6bo4tg_k$('info').get_6bo4tg_k$('movie_image').primitive_uceazd_k$());
        var tmp_20;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(this_6) === 0) {
          tmp_20 = parent.logo_1;
        } else {
          tmp_20 = this_6;
        }
        var tmp_21 = tmp_20;
        var tmp_22 = browser ? row.get_6bo4tg_k$('info').get_6bo4tg_k$('plot').trimmed_hix7di_k$() : row.get_6bo4tg_k$('info').get_6bo4tg_k$('plot').primitive_uceazd_k$();
        var tmp_23 = generated ? label : '';
        var tmp_24 = season_0.string_er2cq7_k$();
        var tmp_25;
        if (browser) {
          tmp_25 = row.get_6bo4tg_k$('episode_num').positive_cd8261_k$();
        } else {
          var tmp5_safe_receiver = toIntOrNull(row.get_6bo4tg_k$('episode_num').primitive_uceazd_k$());
          tmp_25 = tmp5_safe_receiver == null ? null : tmp5_safe_receiver;
        }
        result.add_utx5q5_k$(new XtreamItem(tmp_15, id, 'episode', tmp_16, url, tmp_19, tmp_21, VOID, tmp_22, parent.adult_1, VOID, VOID, tmp_23, VOID, tmp_24, tmp_25));
        if (!browser && result.get_size_woubt6_k$() > 100000)
          throw new XtreamFailure('EPISODES_LIMIT');
      }
    }
    var tmp_26;
    if (browser) {
      // Inline function 'kotlin.collections.groupBy' call
      // Inline function 'kotlin.collections.groupByTo' call
      var destination_1 = LinkedHashMap_init_$Create$();
      var _iterator__ex2g4s_5 = result.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_5.hasNext_bitz1p_k$()) {
        var element_1 = _iterator__ex2g4s_5.next_20eer_k$();
        var key = element_1.season_1;
        // Inline function 'kotlin.collections.getOrPut' call
        var value_0 = destination_1.get_wei43m_k$(key);
        var tmp_27;
        if (value_0 == null) {
          var answer = ArrayList_init_$Create$();
          destination_1.put_4fpzoq_k$(key, answer);
          tmp_27 = answer;
        } else {
          tmp_27 = value_0;
        }
        var list = tmp_27;
        list.add_utx5q5_k$(element_1);
      }
      // Inline function 'kotlin.collections.flatMap' call
      var tmp0 = destination_1.get_values_ksazhn_k$();
      // Inline function 'kotlin.collections.flatMapTo' call
      var destination_2 = ArrayList_init_$Create$();
      var _iterator__ex2g4s_6 = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_6.hasNext_bitz1p_k$()) {
        var element_2 = _iterator__ex2g4s_6.next_20eer_k$();
        // Inline function 'kotlin.collections.sortedBy' call
        // Inline function 'kotlin.comparisons.compareBy' call
        var tmp_28 = XtreamCatalogs$episodes$lambda;
        var tmp$ret$43 = new sam$kotlin_Comparator$0_7(tmp_28);
        var list_0 = sortedWith(element_2, tmp$ret$43);
        addAll(destination_2, list_0);
      }
      tmp_26 = destination_2;
    } else {
      // Inline function 'kotlin.collections.distinctBy' call
      var set = HashSet_init_$Create$();
      var list_1 = ArrayList_init_$Create$();
      var _iterator__ex2g4s_7 = result.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_7.hasNext_bitz1p_k$()) {
        var e = _iterator__ex2g4s_7.next_20eer_k$();
        var key_0 = e.id_1;
        if (set.add_utx5q5_k$(key_0)) {
          list_1.add_utx5q5_k$(e);
        }
      }
      var tmp_29 = list_1;
      // Inline function 'kotlin.comparisons.compareBy' call
      var tmp_30 = XtreamCatalogs$episodes$lambda_0;
      // Inline function 'kotlin.comparisons.thenBy' call
      var this_7 = new sam$kotlin_Comparator$0_7(tmp_30);
      var tmp_31 = XtreamCatalogs$episodes$lambda_1(this_7);
      var tmp$ret$47 = new sam$kotlin_Comparator$0_7(tmp_31);
      tmp_26 = sortedWith(tmp_29, tmp$ret$47);
    }
    var items = tmp_26;
    return new XtreamSeries(items, names, warnings);
  };
  var XtreamCatalogs_instance;
  function XtreamCatalogs_getInstance() {
    return XtreamCatalogs_instance;
  }
  var static_init_called_12;
  function static_init_12() {
    if (static_init_called_12)
      return Unit_instance;
    static_init_called_12 = true;
    XtreamFormat_BROWSER_instance = new XtreamFormat('BROWSER', 0);
    XtreamFormat_ANDROID_instance = new XtreamFormat('ANDROID', 1);
    XtreamFormat_LEGACY_instance = new XtreamFormat('LEGACY', 2);
  }
  var XtreamFormat_BROWSER_instance;
  var XtreamFormat_ANDROID_instance;
  var XtreamFormat_LEGACY_instance;
  function XtreamFormat(name, ordinal) {
    Enum.call(this, name, ordinal);
  }
  function XtreamFailure(code) {
    Exception_init_$Init$_0(code, this);
    captureStack(this, XtreamFailure);
    this.code_1 = code;
  }
  function XtreamRequest(action, params) {
    params = params === VOID ? emptyMap() : params;
    this.action_1 = action;
    this.params_1 = params;
  }
  protoOf(XtreamRequest).toString = function () {
    return 'XtreamRequest(action=' + this.action_1 + ', params=' + toString_1(this.params_1) + ')';
  };
  protoOf(XtreamRequest).hashCode = function () {
    var result = getStringHashCode(this.action_1);
    result = imul(result, 31) + hashCode_0(this.params_1) | 0;
    return result;
  };
  protoOf(XtreamRequest).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof XtreamRequest))
      return false;
    if (!(this.action_1 === other.action_1))
      return false;
    if (!equals(this.params_1, other.params_1))
      return false;
    return true;
  };
  function _get_order__d67t8d($this) {
    return $this.format_1.equals(XtreamFormat_BROWSER_getInstance()) ? $this.browserOrder_1 : $this.androidOrder_1;
  }
  function section($this, action) {
    return contains_1(action, 'live') ? 'live' : contains_1(action, 'vod') ? 'vod' : 'series';
  }
  function advance($this) {
    $this.stage_1 = $this.stage_1 + 1 | 0;
    if ($this.stage_1 === _get_order__d67t8d($this).get_size_woubt6_k$())
      $this.finished_1 = true;
  }
  function XtreamSession$_init_$lambda_s90gj4(_unused_var__etf5q3, _unused_var__etf5q3_0) {
    return Unit_instance;
  }
  function XtreamSession(format, onSection) {
    var tmp;
    if (onSection === VOID) {
      tmp = XtreamSession$_init_$lambda_s90gj4;
    } else {
      tmp = onSection;
    }
    onSection = tmp;
    this.format_1 = format;
    this.onSection_1 = onSection;
    this.stage_1 = -1;
    this.finished_1 = false;
    this.browserOrder_1 = listOf_0(['get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series']);
    this.androidOrder_1 = listOf_0(['get_live_streams', 'get_live_categories', 'get_vod_streams', 'get_vod_categories', 'get_series', 'get_series_categories']);
    var tmp_0 = this;
    // Inline function 'kotlin.collections.linkedMapOf' call
    tmp_0.data_1 = LinkedHashMap_init_$Create$();
    var tmp_1 = this;
    // Inline function 'kotlin.collections.mutableListOf' call
    tmp_1.notices_1 = ArrayList_init_$Create$();
    this.account_1 = Companion_getInstance_13().missing_1;
  }
  protoOf(XtreamSession).get_request_jdwg4m_k$ = function () {
    return this.finished_1 ? null : new XtreamRequest(this.stage_1 < 0 ? '' : _get_order__d67t8d(this).get_c1px32_k$(this.stage_1));
  };
  protoOf(XtreamSession).accept_wd2l5t_k$ = function (response) {
    // Inline function 'kotlin.check' call
    if (!!this.finished_1) {
      var message = 'Xtream request already completed';
      throw IllegalStateException_init_$Create$_0(toString_1(message));
    }
    if (this.stage_1 < 0) {
      this.account_1 = response;
      var user = response.get_6bo4tg_k$('user_info');
      switch (this.format_1.ordinal_1) {
        case 0:
          var tmp;
          if (!response.truthy_eb26j6_k$() || !user.truthy_eb26j6_k$() || !(user.get_6bo4tg_k$('auth').string_er2cq7_k$() === '1')) {
            tmp = true;
          } else {
            var tmp_0;
            if (user.get_6bo4tg_k$('status').truthy_eb26j6_k$()) {
              // Inline function 'kotlin.text.lowercase' call
              // Inline function 'kotlin.js.asDynamic' call
              tmp_0 = !(user.get_6bo4tg_k$('status').string_er2cq7_k$().toLowerCase() === 'active');
            } else {
              tmp_0 = false;
            }
            tmp = tmp_0;
          }

          if (tmp)
            throw new XtreamFailure('BROWSER_AUTH');
          break;
        case 1:
          if (!response.get_isObject_xg6v9u_k$())
            throw new XtreamFailure('ACCOUNT_FORMAT');
          if (listOf_0(['0', 'false']).contains_aljjnj_k$(user.get_6bo4tg_k$('auth').primitive_uceazd_k$()))
            throw new XtreamFailure('AUTH');
          var status = user.get_6bo4tg_k$('status').primitive_uceazd_k$();
          var tmp_1;
          // Inline function 'kotlin.text.isNotBlank' call

          if (!isBlank(status)) {
            tmp_1 = !equals_0(status, 'active', true);
          } else {
            tmp_1 = false;
          }

          if (tmp_1)
            throw new XtreamFailure('INACTIVE');
          break;
        case 2:
          if (!response.get_6bo4tg_k$('live_streams').truthy_eb26j6_k$())
            throw new XtreamFailure('LEGACY_CATALOG');
          if (!response.get_6bo4tg_k$('live_streams').get_isArray_z8qxd2_k$() || (response.get_6bo4tg_k$('categories').truthy_eb26j6_k$() && !response.get_6bo4tg_k$('categories').get_isArray_z8qxd2_k$()))
            throw new XtreamFailure('LEGACY_CATALOG');
          var tmp0 = this.data_1;
          var tmp2 = 'get_live_streams';
          // Inline function 'kotlin.collections.set' call

          var value = response.get_6bo4tg_k$('live_streams');
          tmp0.put_4fpzoq_k$(tmp2, value);
          var tmp0_0 = this.data_1;
          var tmp2_0 = 'get_live_categories';
          // Inline function 'kotlin.collections.set' call

          var value_0 = response.get_6bo4tg_k$('categories').get_isArray_z8qxd2_k$() ? response.get_6bo4tg_k$('categories') : Companion_getInstance_13().array$default_yx37t8_k$();
          tmp0_0.put_4fpzoq_k$(tmp2_0, value_0);
          this.finished_1 = true;
          return Unit_instance;
        default:
          noWhenBranchMatchedException();
          break;
      }
      if (this.format_1.equals(XtreamFormat_ANDROID_getInstance()) && response.get_6bo4tg_k$('live_streams').get_isArray_z8qxd2_k$()) {
        var tmp0_1 = this.data_1;
        var tmp2_1 = 'get_live_streams';
        // Inline function 'kotlin.collections.set' call
        var value_1 = response.get_6bo4tg_k$('live_streams');
        tmp0_1.put_4fpzoq_k$(tmp2_1, value_1);
        var tmp0_2 = this.data_1;
        var tmp2_2 = 'get_live_categories';
        // Inline function 'kotlin.collections.set' call
        var value_2 = response.get_6bo4tg_k$('categories').get_isArray_z8qxd2_k$() ? response.get_6bo4tg_k$('categories') : Companion_getInstance_13().array$default_yx37t8_k$();
        tmp0_2.put_4fpzoq_k$(tmp2_2, value_2);
        this.onSection_1('live', this.data_1);
        this.stage_1 = 2;
      } else
        this.stage_1 = 0;
      return Unit_instance;
    }
    var action = _get_order__d67t8d(this).get_c1px32_k$(this.stage_1);
    if (this.format_1.equals(XtreamFormat_BROWSER_getInstance()) && response.get_6bo4tg_k$('user_info').truthy_eb26j6_k$() && !(response.get_6bo4tg_k$('user_info').get_6bo4tg_k$('auth').string_er2cq7_k$() === '1'))
      throw new XtreamFailure('RESPONSE_AUTH');
    if (!response.get_isArray_z8qxd2_k$())
      throw new XtreamFailure(this.format_1.equals(XtreamFormat_BROWSER_getInstance()) ? 'BROWSER_CATALOG' : endsWith(action, 'categories') ? 'CATEGORY_FORMAT' : 'CATALOG_FORMAT');
    // Inline function 'kotlin.collections.set' call
    this.data_1.put_4fpzoq_k$(action, response);
    if (this.format_1.equals(XtreamFormat_ANDROID_getInstance()) && endsWith(action, 'categories'))
      this.onSection_1(section(this, action), this.data_1);
    advance(this);
  };
  function XtreamSource(id, username, password, output) {
    output = output === VOID ? 'm3u8' : output;
    this.id_1 = id;
    this.username_1 = username;
    this.password_1 = password;
    this.output_1 = output;
  }
  protoOf(XtreamSource).toString = function () {
    return 'XtreamSource(id=' + this.id_1 + ')';
  };
  protoOf(XtreamSource).hashCode = function () {
    var result = getStringHashCode(this.id_1);
    result = imul(result, 31) + getStringHashCode(this.username_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.password_1) | 0;
    result = imul(result, 31) + getStringHashCode(this.output_1) | 0;
    return result;
  };
  protoOf(XtreamSource).equals = function (other) {
    if (this === other)
      return true;
    if (!(other instanceof XtreamSource))
      return false;
    if (!(this.id_1 === other.id_1))
      return false;
    if (!(this.username_1 === other.username_1))
      return false;
    if (!(this.password_1 === other.password_1))
      return false;
    if (!(this.output_1 === other.output_1))
      return false;
    return true;
  };
  function credentials($this) {
    return listOf_0([to('username', $this.source_1.username_1), to('password', $this.source_1.password_1)]);
  }
  function Companion_15() {
  }
  protoOf(Companion_15).browserBase_s0uj0h_k$ = function (value) {
    var clean = substringBefore(substringBefore(value, _Char___init__impl__6a9atx(63)), _Char___init__impl__6a9atx(35));
    var candidate = removeSuffix(clean, '/');
    // Inline function 'kotlin.text.lowercase' call
    // Inline function 'kotlin.js.asDynamic' call
    var last = substringAfterLast(candidate, _Char___init__impl__6a9atx(47)).toLowerCase();
    return trimEnd(listOf_0(['player_api.php', 'get.php', 'xmltv.php']).contains_aljjnj_k$(last) ? substringBeforeLast(candidate, _Char___init__impl__6a9atx(47)) : clean, charArrayOf([_Char___init__impl__6a9atx(47)]));
  };
  var Companion_instance_15;
  function Companion_getInstance_15() {
    return Companion_instance_15;
  }
  function XtreamAddresses(source, render, segment) {
    this.source_1 = source;
    this.render_1 = render;
    this.segment_1 = segment;
  }
  protoOf(XtreamAddresses).api_hsene1_k$ = function (request) {
    var tmp = listOf('player_api.php');
    var tmp_0 = credentials(this);
    var tmp_1;
    // Inline function 'kotlin.text.isNotEmpty' call
    var this_0 = request.action_1;
    if (charSequenceLength(this_0) > 0) {
      tmp_1 = listOf(to('action', request.action_1));
    } else {
      tmp_1 = emptyList();
    }
    return this.render_1(tmp, plus(plus(tmp_0, tmp_1), toList_1(request.params_1)));
  };
  protoOf(XtreamAddresses).epg_25ng_k$ = function () {
    return this.render_1(listOf('xmltv.php'), credentials(this));
  };
  protoOf(XtreamAddresses).stream_w3koca_k$ = function (type, id, extension) {
    return this.render_1(listOf_0([type, this.source_1.username_1, this.source_1.password_1, id + '.' + extension]), emptyList());
  };
  protoOf(XtreamAddresses).legacyShortEpg_7mvhu7_k$ = function (id) {
    return this.api_hsene1_k$(new XtreamRequest('')) + '&action=get_short_epg&stream_id=' + id;
  };
  protoOf(XtreamAddresses).legacyStream_4sx44x_k$ = function (id) {
    return this.render_1(listOf_0(['live', this.source_1.username_1, this.source_1.password_1]), emptyList()) + ('/' + id + '.m3u8');
  };
  protoOf(XtreamAddresses).legacyPlaylist_76ezs6_k$ = function (base, networkFailure) {
    var tmp;
    if (networkFailure) {
      tmp = trimEnd(base, charArrayOf([_Char___init__impl__6a9atx(47)])) + '/get.php?username=' + this.segment_1(this.source_1.username_1) + '&password=' + this.segment_1(this.source_1.password_1);
    } else {
      tmp = CoreText_getInstance().replaceLiteralFirst_r86yx1_k$(this.api_hsene1_k$(new XtreamRequest('')), '/player_api.php', '/get.php');
    }
    var endpoint = tmp;
    return endpoint + '&type=m3u_plus&output=ts';
  };
  protoOf(XtreamAddresses).archive_jmizrc_k$ = function (id) {
    return trimEnd(this.render_1(listOf_0(['timeshift', this.source_1.username_1, this.source_1.password_1]), emptyList()), charArrayOf([_Char___init__impl__6a9atx(47)])) + '/{durationMinutes}/{startDate}/' + this.segment_1(id + '.ts');
  };
  function XtreamFormat_BROWSER_getInstance() {
    static_init_12();
    return XtreamFormat_BROWSER_instance;
  }
  function XtreamFormat_ANDROID_getInstance() {
    static_init_12();
    return XtreamFormat_ANDROID_instance;
  }
  function XtreamFormat_LEGACY_getInstance() {
    static_init_12();
    return XtreamFormat_LEGACY_instance;
  }
  function get_nativeClocks() {
    _init_properties_Exports_kt__2habub();
    return nativeClocks;
  }
  var nativeClocks;
  function parseXmltvTimestamp(value) {
    _init_properties_Exports_kt__2habub();
    return GuideTime_getInstance().milliseconds$default_vkp5qz_k$(value);
  }
  function parseBrowserXmltvTime(value) {
    _init_properties_Exports_kt__2habub();
    var tmp0_safe_receiver = GuideTime_getInstance().milliseconds_lcf5oq_k$(value, GuideTimeFormat_BROWSER_getInstance());
    return tmp0_safe_receiver == null ? null : tmp0_safe_receiver / 1000;
  }
  function normalizedChannelName(value) {
    _init_properties_Exports_kt__2habub();
    return GuideNames_instance.normalized_qcj5er_k$(value);
  }
  function canonicalChannelName(value) {
    _init_properties_Exports_kt__2habub();
    return GuideNames_instance.canonical_yvzfne_k$(value);
  }
  function chooseGuideChannel(ids, exact, aliases) {
    _init_properties_Exports_kt__2habub();
    var tmp = GuideNames_instance;
    var tmp_0 = toList(ids);
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(exact.length);
    var inductionVariable = 0;
    var last = exact.length;
    while (inductionVariable < last) {
      var item = exact[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var tmp$ret$2 = toList(item);
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    var tmp_1 = destination;
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination_0 = ArrayList_init_$Create$_0(aliases.length);
    var inductionVariable_0 = 0;
    var last_0 = aliases.length;
    while (inductionVariable_0 < last_0) {
      var item_0 = aliases[inductionVariable_0];
      inductionVariable_0 = inductionVariable_0 + 1 | 0;
      var tmp$ret$5 = toList(item_0);
      destination_0.add_utx5q5_k$(tmp$ret$5);
    }
    return tmp.chooseOrdered_naq0mk_k$(tmp_0, tmp_1, destination_0);
  }
  function ScheduleSelection(current, next, from, until) {
    this.current = current;
    this.next = next;
    this.from = from;
    this.until = until;
  }
  protoOf(ScheduleSelection).get_current_jwi6j4_k$ = function () {
    return this.current;
  };
  protoOf(ScheduleSelection).get_next_wor1vg_k$ = function () {
    return this.next;
  };
  protoOf(ScheduleSelection).get_from_wom7eb_k$ = function () {
    return this.from;
  };
  protoOf(ScheduleSelection).get_until_izq2b9_k$ = function () {
    return this.until;
  };
  function selectGuideSchedule(entries, now, openEnds) {
    _init_properties_Exports_kt__2habub();
    var tmp = GuideSchedule_instance;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp_0 = entries.length;
    var tmp_1 = selectGuideSchedule$lambda(entries, openEnds);
    var result = tmp.select_mlzbmh_k$(tmp_0, tmp_1, selectGuideSchedule$lambda_0(entries, openEnds), now, openEnds);
    return new ScheduleSelection(result.current_1, result.next_1, result.from_1, result.until_1);
  }
  function nativeGuideTime(value, format) {
    _init_properties_Exports_kt__2habub();
    return getValue(get_nativeClocks(), nativeFormat(format)).seconds_rbj0rf_k$(value);
  }
  function nativeGuideName(value, format) {
    _init_properties_Exports_kt__2habub();
    return NativeGuideNames_instance.normalized_q2vtcv_k$(value, nativeFormat(format));
  }
  function nativeGuideStripShift(value, format) {
    _init_properties_Exports_kt__2habub();
    return NativeGuideNames_instance.stripShift_dpnto2_k$(value, nativeFormat(format));
  }
  function nativeGuideShift(value, format) {
    _init_properties_Exports_kt__2habub();
    return NativeGuideNames_instance.regionalShift_dpnawl_k$(value, nativeFormat(format));
  }
  function NativeMatch(id, score) {
    this.id = id;
    this.score = score;
  }
  protoOf(NativeMatch).get_id_kntnx8_k$ = function () {
    return this.id;
  };
  protoOf(NativeMatch).get_score_iyfcrt_k$ = function () {
    return this.score;
  };
  function NativeGuide(rows, format, measure, precision) {
    var tmp = this;
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(rows.length);
    var inductionVariable = 0;
    var last = rows.length;
    while (inductionVariable < last) {
      var item = rows[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var tmp$ret$2 = new NativeGuideEntry(item[0], item[1]);
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    tmp.index_1 = new NativeGuideIndex(destination, nativeFormat(format), measure, precision);
  }
  protoOf(NativeGuide).match = function (value) {
    var tmp0_safe_receiver = this.index_1.match_m4pled_k$(value);
    var tmp;
    if (tmp0_safe_receiver == null) {
      tmp = null;
    } else {
      // Inline function 'kotlin.let' call
      tmp = new NativeMatch(tmp0_safe_receiver.id_1, tmp0_safe_receiver.score_1);
    }
    return tmp;
  };
  protoOf(NativeGuide).resolve = function (id, candidates) {
    return this.index_1.resolve_rchogc_k$(id, toList(candidates));
  };
  function nativeGuideSlice(times, now, archiveHours, shiftHours) {
    _init_properties_Exports_kt__2habub();
    var window_0 = new NativeGuideWindow(now, archiveHours, shiftHours);
    // Inline function 'kotlin.collections.mapIndexedNotNull' call
    // Inline function 'kotlin.collections.mapIndexedNotNullTo' call
    var destination = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.forEachIndexed' call
    var index = 0;
    var inductionVariable = 0;
    var last = times.length;
    while (inductionVariable < last) {
      var item = times[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var _unary__edvuaz = index;
      index = _unary__edvuaz + 1 | 0;
      var tmp;
      if (window_0.includes_bqdor_k$(item[0], item[1])) {
        // Inline function 'kotlin.arrayOf' call
        // Inline function 'kotlin.js.unsafeCast' call
        // Inline function 'kotlin.js.asDynamic' call
        tmp = [_unary__edvuaz, item[0] + window_0.shift_1, item[1] + window_0.shift_1];
      } else {
        tmp = null;
      }
      var tmp0_safe_receiver = tmp;
      if (tmp0_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        destination.add_utx5q5_k$(tmp0_safe_receiver);
      }
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    return copyToArray(destination);
  }
  function archiveUrl(input, calendar, resolveUrl) {
    _init_properties_Exports_kt__2habub();
    var tmp0_url = archiveUrl$text(input, 'url');
    var tmp1_mode = archiveUrl$text(input, 'mode');
    var tmp2_source = archiveUrl$text(input, 'source');
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp3_days = input.days;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp4_start = input.start;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp5_end = input.end;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp6_now = input.now;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp7_correction = input.correction;
    var tmp8_programmeId = archiveUrl$text(input, 'programmeId');
    var tmp9_base = archiveUrl$text(input, 'base');
    var tmp10_streamId = archiveUrl$text(input, 'streamId');
    var tmp11_extension = archiveUrl$text(input, 'extension');
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp12_username = input.username;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp13_password = input.password;
    var request = new ArchiveRequest(tmp0_url, tmp1_mode, tmp2_source, tmp3_days, tmp4_start, tmp5_end, tmp6_now, tmp7_correction, tmp8_programmeId, tmp9_base, tmp12_username, tmp13_password, tmp10_streamId, tmp11_extension);
    var tmp = Archive_getInstance();
    var tmp_0 = ArchiveFormat_BROWSER_getInstance();
    return tmp.resolve_obujz6_k$(request, tmp_0, archiveUrl$lambda(calendar), resolveUrl);
  }
  function providerArchiveUrl(profile, url, source, mode, start, end, now, dune, variant) {
    _init_properties_Exports_kt__2habub();
    return Archive_getInstance().provider_rls0fs_k$(profile, url, source, mode, start, end, now, dune, variant);
  }
  function parseBrowserPlaylist(text, prefix, sourceId, resolve, hash, component) {
    _init_properties_Exports_kt__2habub();
    var result = {};
    var tmp;
    try {
      var tmp_0 = Playlist_getInstance();
      var tmp_1 = PlaylistFormat_BROWSER_getInstance();
      tmp = tmp_0.read$default_8tkxrb_k$(text, tmp_1, prefix, resolve, parseBrowserPlaylist$lambda(hash), component);
    } catch ($p) {
      var tmp_2;
      if ($p instanceof PlaylistFailure) {
        var failure = $p;
        result.failure = failure.code_1;
        return result;
      } else {
        throw $p;
      }
    }
    var parsed = tmp;
    // Inline function 'kotlin.collections.map' call
    var this_0 = parsed.entries_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var row = {};
      row.id = item.id_1;
      row.name = item.name_1;
      row.url = item.url_1;
      row.group = item.group_1;
      row.logo = item.logo_1;
      row.tvgId = item.epgId_1;
      row.tvgName = item.epgName_1;
      row.kind = item.movie_1 ? 'vod' : 'live';
      row.sourceId = sourceId;
      row.tvgShift = item.shift_1;
      // Inline function 'kotlin.collections.toTypedArray' call
      var this_1 = item.epgUrls_1;
      row.epgUrls = copyToArray(this_1);
      var tmp0_safe_receiver = item.archive_1;
      if (tmp0_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        var archive = {};
        archive.type = tmp0_safe_receiver.mode_1;
        archive.source = tmp0_safe_receiver.source_1;
        archive.days = tmp0_safe_receiver.days_1;
        archive.correction = tmp0_safe_receiver.correction_1;
        row.catchup = archive;
      }
      destination.add_utx5q5_k$(row);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.channels = copyToArray(destination);
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_2 = parsed.epgUrls_1;
    result.epgUrls = copyToArray(this_2);
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_3 = parsed.warnings_1;
    result.warnings = copyToArray(this_3);
    return result;
  }
  function legacyPlaylistAttribute(text, name) {
    _init_properties_Exports_kt__2habub();
    return ProviderPlaylist_instance.attribute_s7yxes_k$(text, name);
  }
  function parseProviderPlaylist(text, profile, hash, fallbackHours) {
    _init_properties_Exports_kt__2habub();
    var parsed = ProviderPlaylist_instance.read_70pny9_k$(text, profile === 'generic' ? ProviderPlaylistFormat_GENERIC_getInstance() : ProviderPlaylistFormat_M3U_getInstance(), hash, fallbackHours);
    var result = {};
    result.header = parsed.header_1;
    // Inline function 'kotlin.collections.map' call
    var this_0 = parsed.entries_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = item.id_1;
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.ids = copyToArray(destination);
    result.groups = Object.create(null);
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_0 = parsed.groups_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s_0.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var key = element.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var ids = element.get_value_j01efc_k$();
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp$ret$9 = copyToArray(ids);
      result.groups[key] = tmp$ret$9;
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_1 = parsed.groupOrder_1;
    result.groupOrder = copyToArray(this_1);
    result.channels = Object.create(null);
    // Inline function 'kotlin.collections.map' call
    var this_2 = parsed.entries_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination_0 = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_2, 10));
    var _iterator__ex2g4s_1 = this_2.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
      var item_0 = _iterator__ex2g4s_1.next_20eer_k$();
      var row = {};
      row.id = item_0.id_1;
      row.name = item_0.name_1;
      row.url = item_0.url_1;
      row.group = item_0.group_1;
      row.category = item_0.category_1;
      row.logo = item_0.logo_1;
      row.epgId = item_0.epgId_1;
      row.epgName = item_0.epgName_1;
      row.archiveHours = item_0.archiveHours_1;
      row.archiveMode = item_0.archiveMode_1;
      row.archiveSource = item_0.archiveSource_1;
      row.shift = item_0.shift_1;
      row.raw = item_0.raw_1;
      row.titleHashInput = item_0.titleHashInput_1;
      row.generatedName = item_0.generatedName_1;
      var channel = {};
      channel.ca = item_0.archiveMode_1;
      channel.caso = item_0.archiveSource_1;
      channel.category = {};
      channel.category.class = item_0.category_1;
      channel.category.name = item_0.group_1;
      channel.channel_name = item_0.name_1;
      channel.epg = item_0.epgId_1;
      channel.logo = item_0.logo_1;
      channel.rec = item_0.archiveHours_1;
      channel.time = 0;
      channel.time_to = 0;
      channel.tn = item_0.epgName_1;
      channel.url = item_0.url_1;
      if (!(item_0.shift_1 === 0.0))
        channel.ts = item_0.shift_1;
      result.channels[item_0.id_1] = channel;
      destination_0.add_utx5q5_k$(row);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.entries = copyToArray(destination_0);
    return result;
  }
  function parsePlaylistMedia(text) {
    _init_properties_Exports_kt__2habub();
    // Inline function 'kotlin.collections.map' call
    var this_0 = OperatorPlaylist_instance.media_mdug2y_k$(text);
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var row = {};
      row.name = item.name_1;
      row.generatedName = item.generatedName_1;
      row.url = item.url_1;
      row.logo = item.logo_1;
      destination.add_utx5q5_k$(row);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    return copyToArray(destination);
  }
  function parseOperatorPlaylist(text, profile, hash, existing) {
    _init_properties_Exports_kt__2habub();
    var parsed = OperatorPlaylist_instance.read_orfpvl_k$(text, profile, hash, toSet(existing));
    var result = {};
    // Inline function 'kotlin.collections.map' call
    var this_0 = parsed.entries_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = parseOperatorPlaylist$key(item.id_1);
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.ids = copyToArray(destination);
    result.groups = Object.create(null);
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_0 = parsed.groups_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s_0.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var name = element.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var ids = element.get_value_j01efc_k$();
      // Inline function 'kotlin.collections.map' call
      // Inline function 'kotlin.collections.mapTo' call
      var destination_0 = ArrayList_init_$Create$_0(collectionSizeOrDefault(ids, 10));
      var _iterator__ex2g4s_1 = ids.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
        var item_0 = _iterator__ex2g4s_1.next_20eer_k$();
        var tmp$ret$11 = parseOperatorPlaylist$key(item_0);
        destination_0.add_utx5q5_k$(tmp$ret$11);
      }
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp$ret$12 = copyToArray(destination_0);
      result.groups[name] = tmp$ret$12;
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_1 = parsed.groupOrder_1;
    result.groupOrder = copyToArray(this_1);
    result.channels = Object.create(null);
    result.malformed = parsed.malformed_1;
    // Inline function 'kotlin.collections.map' call
    var this_2 = parsed.entries_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination_1 = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_2, 10));
    var _iterator__ex2g4s_2 = this_2.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
      var item_1 = _iterator__ex2g4s_2.next_20eer_k$();
      var channel = {};
      channel.category = {};
      channel.category.class = item_1.category_1;
      channel.category.name = item_1.group_1;
      if (!(profile === 'shura')) {
        channel.channel_name = item_1.name_1;
        channel.url = item_1.url_1;
        channel.logo = item_1.logo_1;
        var tmp0_elvis_lhs = item_1.hours_1;
        channel.rec = tmp0_elvis_lhs == null ? item_1.fallbackHours_1 : tmp0_elvis_lhs;
        channel.time = 0;
        channel.time_to = 0;
        if (!(profile === 'tvteam'))
          channel.epg = item_1.epgId_1;
        if (profile === 'edem' || profile === 'kb-team') {
          channel.ca = item_1.mode_1;
          channel.caso = item_1.archive_1;
          channel.tn = item_1.epgName_1;
          channel.utvg = item_1.feed_1;
        }
        if (profile === 'kb-team')
          channel.drm = item_1.drm_1;
        if (profile === 'shara-tv') {
          channel.ch_id = item_1.id_1;
          channel.aurl = item_1.archive_1;
        }
        if (profile === 'antifriz') {
          channel.epg_id = item_1.epgId_1;
          channel.server = item_1.server_1;
          channel.token = item_1.token_1;
        }
      }
      result.channels[parseOperatorPlaylist$key(item_1.id_1)] = channel;
      var row = {};
      row.id = parseOperatorPlaylist$key(item_1.id_1);
      row.generatedName = item_1.generatedName_1;
      row.channel = channel;
      destination_1.add_utx5q5_k$(row);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.entries = copyToArray(destination_1);
    return result;
  }
  function nativeFormat(value) {
    _init_properties_Exports_kt__2habub();
    var tmp;
    switch (value) {
      case 'rust':
        tmp = NativeGuideFormat_RUST_getInstance();
        break;
      case 'web':
        tmp = NativeGuideFormat_WEB_getInstance();
        break;
      case 'swift':
        tmp = NativeGuideFormat_SWIFT_getInstance();
        break;
      case 'archived-android':
        tmp = NativeGuideFormat_ARCHIVED_ANDROID_getInstance();
        break;
      default:
        // Inline function 'kotlin.error' call

        var message = 'Unknown native guide format: ' + value;
        throw IllegalStateException_init_$Create$_0(toString_1(message));
    }
    return tmp;
  }
  function selectGuideSchedule$field($entries, $openEnds, index, name) {
    var entry = $entries[index];
    if (entry == null)
      return NaN;
    var value = entry[name];
    if (name === 'end' && value == null && $openEnds)
      return Infinity;
    var tmp;
    if (typeof value === 'number') {
      // Inline function 'kotlin.js.unsafeCast' call
      tmp = value;
    } else {
      tmp = NaN;
    }
    return tmp;
  }
  function selectGuideSchedule$lambda($entries, $openEnds) {
    return function (it) {
      return selectGuideSchedule$field($entries, $openEnds, it, 'start');
    };
  }
  function selectGuideSchedule$lambda_0($entries, $openEnds) {
    return function (it) {
      return selectGuideSchedule$field($entries, $openEnds, it, 'end');
    };
  }
  function archiveUrl$text($input, key) {
    var tmp;
    if ($input[key] == null) {
      tmp = '';
    } else {
      // Inline function 'kotlin.js.unsafeCast' call
      tmp = $input[key];
    }
    return tmp;
  }
  function archiveUrl$lambda($calendar) {
    return function (it) {
      return toList($calendar(it));
    };
  }
  function parseBrowserPlaylist$lambda($hash) {
    return function (it) {
      return $hash(it.get_c1px32_k$(0));
    };
  }
  function parseOperatorPlaylist$key(value) {
    return value == null ? undefined : value;
  }
  var properties_initialized_Exports_kt_cdrv2n;
  function _init_properties_Exports_kt__2habub() {
    if (!properties_initialized_Exports_kt_cdrv2n) {
      properties_initialized_Exports_kt_cdrv2n = true;
      // Inline function 'kotlin.collections.associateWith' call
      var this_0 = get_entries();
      var result = LinkedHashMap_init_$Create$_0(coerceAtLeast(mapCapacity(collectionSizeOrDefault(this_0, 10)), 16));
      // Inline function 'kotlin.collections.associateWithTo' call
      var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        var tmp$ret$2 = new NativeGuideClock(element);
        result.put_4fpzoq_k$(element, tmp$ret$2);
      }
      nativeClocks = result;
    }
  }
  function parseBrowserGuide(stations, programmes, fields, source, identity, icon) {
    var tmp = GuideFeeds_getInstance();
    // Inline function 'kotlin.collections.map' call
    var this_0 = guideArray(stations);
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(this_0.length);
    var inductionVariable = 0;
    var last = this_0.length;
    while (inductionVariable < last) {
      var item = this_0[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var tmp_0 = guideText(item.id);
      // Inline function 'kotlin.collections.map' call
      var this_1 = guideArray(item.names);
      // Inline function 'kotlin.collections.mapTo' call
      var destination_0 = ArrayList_init_$Create$_0(this_1.length);
      var inductionVariable_0 = 0;
      var last_0 = this_1.length;
      while (inductionVariable_0 < last_0) {
        var item_0 = this_1[inductionVariable_0];
        inductionVariable_0 = inductionVariable_0 + 1 | 0;
        var tmp$ret$5 = guideText(item_0);
        destination_0.add_utx5q5_k$(tmp$ret$5);
      }
      var tmp_1 = destination_0;
      // Inline function 'kotlin.collections.map' call
      var this_2 = guideArray(item.icons);
      // Inline function 'kotlin.collections.mapTo' call
      var destination_1 = ArrayList_init_$Create$_0(this_2.length);
      var inductionVariable_1 = 0;
      var last_1 = this_2.length;
      while (inductionVariable_1 < last_1) {
        var item_1 = this_2[inductionVariable_1];
        inductionVariable_1 = inductionVariable_1 + 1 | 0;
        var tmp$ret$8 = guideText(item_1);
        destination_1.add_utx5q5_k$(tmp$ret$8);
      }
      var tmp$ret$2 = new GuideRawStation(tmp_0, tmp_1, destination_1);
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    var tmp_2 = destination;
    // Inline function 'kotlin.collections.map' call
    var this_3 = guideArray(programmes);
    // Inline function 'kotlin.collections.mapTo' call
    var destination_2 = ArrayList_init_$Create$_0(this_3.length);
    var inductionVariable_2 = 0;
    var last_2 = this_3.length;
    while (inductionVariable_2 < last_2) {
      var item_2 = this_3[inductionVariable_2];
      inductionVariable_2 = inductionVariable_2 + 1 | 0;
      var tmp$ret$11 = new GuideRawProgramme(guideText(item_2.channel), guideText(item_2.start), guideText(item_2.stop), guideText(item_2.title), guideText(item_2.description), guideText(item_2.catchupAttribute), guideText(item_2.catchupElement));
      destination_2.add_utx5q5_k$(tmp$ret$11);
    }
    var parsed = tmp.parse_ssjknu_k$(tmp_2, destination_2, icon);
    // Inline function 'kotlin.collections.mutableMapOf' call
    var records = LinkedHashMap_init_$Create$();
    var models = new GuideModels(parseBrowserGuide$lambda(records));
    var result = models.catalog_20ss23_k$(parsed.catalog_1);
    result.sourceUrl = source;
    result.feedIdentity = identity;
    var tmp_3 = Companion_instance_12;
    // Inline function 'kotlin.collections.associateWith' call
    var this_4 = guideKeys(fields);
    var result_0 = LinkedHashMap_init_$Create$_0(coerceAtLeast(mapCapacity(this_4.length), 16));
    // Inline function 'kotlin.collections.associateWithTo' call
    var inductionVariable_3 = 0;
    var last_3 = this_4.length;
    while (inductionVariable_3 < last_3) {
      var element = this_4[inductionVariable_3];
      inductionVariable_3 = inductionVariable_3 + 1 | 0;
      var tmp$ret$15 = guideText(fields[element]);
      result_0.put_4fpzoq_k$(element, tmp$ret$15);
    }
    result.coverage = coverage(tmp_3.parse_l2r7v4_k$(result_0));
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_5 = parsed.warnings_1;
    result.warnings = copyToArray(this_5);
    return result;
  }
  function mergeBrowserGuides(guides, logo) {
    // Inline function 'kotlin.collections.mutableListOf' call
    var payloads = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.mapIndexedNotNull' call
    var tmp0 = guideArray(guides);
    // Inline function 'kotlin.collections.mapIndexedNotNullTo' call
    var destination = ArrayList_init_$Create$();
    // Inline function 'kotlin.collections.forEachIndexed' call
    var index = 0;
    var inductionVariable = 0;
    var last = tmp0.length;
    while (inductionVariable < last) {
      var item = tmp0[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var _unary__edvuaz = index;
      index = _unary__edvuaz + 1 | 0;
      var tmp$ret$5;
      $l$block: {
        if (item == null) {
          tmp$ret$5 = null;
          break $l$block;
        }
        var values = Companion_instance_12.fromValue_cdaik0_k$(wire(item.coverage));
        var url = guideText(item.sourceUrl);
        // Inline function 'kotlin.text.ifEmpty' call
        var tmp;
        // Inline function 'kotlin.text.isEmpty' call
        if (charSequenceLength(url) === 0) {
          // Inline function 'kotlin.text.ifEmpty' call
          var this_0 = guideText(item.feedIdentity);
          var tmp_0;
          // Inline function 'kotlin.text.isEmpty' call
          if (charSequenceLength(this_0) === 0) {
            tmp_0 = 'anonymous-merge:' + _unary__edvuaz;
          } else {
            tmp_0 = this_0;
          }
          tmp = tmp_0;
        } else {
          tmp = url;
        }
        var tmp_1 = tmp;
        // Inline function 'kotlin.collections.map' call
        var this_1 = guideArray(item.channels);
        // Inline function 'kotlin.collections.mapTo' call
        var destination_0 = ArrayList_init_$Create$_0(this_1.length);
        var inductionVariable_0 = 0;
        var last_0 = this_1.length;
        while (inductionVariable_0 < last_0) {
          var item_0 = this_1[inductionVariable_0];
          inductionVariable_0 = inductionVariable_0 + 1 | 0;
          var tmp_2 = guideText(item_0.id);
          // Inline function 'kotlin.collections.map' call
          var this_2 = guideArray(item_0.names);
          // Inline function 'kotlin.collections.mapTo' call
          var destination_1 = ArrayList_init_$Create$_0(this_2.length);
          var inductionVariable_1 = 0;
          var last_1 = this_2.length;
          while (inductionVariable_1 < last_1) {
            var item_1 = this_2[inductionVariable_1];
            inductionVariable_1 = inductionVariable_1 + 1 | 0;
            var tmp$ret$17 = guideText(item_1);
            destination_1.add_utx5q5_k$(tmp$ret$17);
          }
          var tmp$ret$14 = new GuideStation(tmp_2, toMutableList(destination_1), guideText(item_0.logo));
          destination_0.add_utx5q5_k$(tmp$ret$14);
        }
        var tmp_3 = destination_0;
        var tmp_4 = toList(guideKeys(item.byChannel));
        // Inline function 'kotlin.collections.map' call
        var this_3 = guideArray(item.programmes);
        // Inline function 'kotlin.collections.mapTo' call
        var destination_2 = ArrayList_init_$Create$_0(this_3.length);
        var inductionVariable_2 = 0;
        var last_2 = this_3.length;
        while (inductionVariable_2 < last_2) {
          var item_2 = this_3[inductionVariable_2];
          inductionVariable_2 = inductionVariable_2 + 1 | 0;
          var slot = payloads.get_size_woubt6_k$();
          payloads.add_utx5q5_k$(item_2);
          var tmp_5 = guideText(item_2.channelId);
          // Inline function 'kotlin.js.unsafeCast' call
          var tmp_6 = item_2.start;
          // Inline function 'kotlin.js.unsafeCast' call
          var tmp$ret$22 = item_2.end;
          var tmp$ret$20 = new GuideRecord(tmp_5, tmp_6, tmp$ret$22, guideText(item_2.title), slot);
          destination_2.add_utx5q5_k$(tmp$ret$20);
        }
        var tmp_7 = destination_2;
        // Inline function 'kotlin.collections.map' call
        var this_4 = guideArray(item.warnings);
        // Inline function 'kotlin.collections.mapTo' call
        var destination_3 = ArrayList_init_$Create$_0(this_4.length);
        var inductionVariable_3 = 0;
        var last_3 = this_4.length;
        while (inductionVariable_3 < last_3) {
          var item_3 = this_4[inductionVariable_3];
          inductionVariable_3 = inductionVariable_3 + 1 | 0;
          var tmp$ret$25 = guideText(item_3);
          destination_3.add_utx5q5_k$(tmp$ret$25);
        }
        tmp$ret$5 = new GuideFeedInput(tmp_1, url, tmp_3, tmp_4, tmp_7, values, destination_3);
      }
      var tmp0_safe_receiver = tmp$ret$5;
      if (tmp0_safe_receiver == null)
        null;
      else {
        // Inline function 'kotlin.let' call
        destination.add_utx5q5_k$(tmp0_safe_receiver);
      }
    }
    var inputs = destination;
    var tmp_8 = GuideFeeds_getInstance();
    var merged = tmp_8.merge_mhxzy4_k$(inputs, mergeBrowserGuides$lambda, logo);
    var models = new GuideModels(mergeBrowserGuides$lambda_0(payloads));
    var result = models.catalog_20ss23_k$(merged.catalog_1);
    result.byRawId = dictionary();
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s = merged.rawIds_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var key = element.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var ids = element.get_value_j01efc_k$();
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp$ret$33 = copyToArray(ids);
      result.byRawId[key] = tmp$ret$33;
    }
    // Inline function 'kotlin.collections.map' call
    var this_5 = merged.feeds_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination_4 = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_5, 10));
    var _iterator__ex2g4s_0 = this_5.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var item_4 = _iterator__ex2g4s_0.next_20eer_k$();
      var feed = {};
      feed.identity = item_4.identity_1;
      feed.sourceUrl = item_4.sourceUrl_1;
      feed.keys = dictionary();
      // Inline function 'kotlin.collections.forEach' call
      // Inline function 'kotlin.collections.iterator' call
      var _iterator__ex2g4s_1 = item_4.keys_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
      while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
        var element_0 = _iterator__ex2g4s_1.next_20eer_k$();
        // Inline function 'kotlin.collections.component1' call
        var id = element_0.get_key_18j28a_k$();
        // Inline function 'kotlin.collections.component2' call
        var key_0 = element_0.get_value_j01efc_k$();
        feed.keys[id] = key_0;
      }
      feed.guide = models.catalog_20ss23_k$(item_4.guide_1);
      destination_4.add_utx5q5_k$(feed);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.feeds = copyToArray(destination_4);
    result.coverage = coverage(merged.coverage_1);
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_6 = merged.warnings_1;
    result.warnings = copyToArray(this_6);
    return result;
  }
  function matchedGuideChannel(channel, guide) {
    if (guide == null || guide.feeds == null) {
      // Inline function 'kotlin.text.orEmpty' call
      var tmp0_elvis_lhs = matchedGuideChannel$plain(channel, guide, false);
      return tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
    }
    var feeds = guideArray(guide.feeds);
    var tmp = GuideFeeds_getInstance();
    // Inline function 'kotlin.collections.map' call
    var this_0 = guideArray(channel == null ? null : channel.epgUrls);
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(this_0.length);
    var inductionVariable = 0;
    var last = this_0.length;
    while (inductionVariable < last) {
      var item = this_0[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var tmp$ret$3 = guideText(item);
      destination.add_utx5q5_k$(tmp$ret$3);
    }
    var tmp_0 = destination;
    var tmp_1 = feeds.length;
    var tmp_2 = matchedGuideChannel$lambda(feeds);
    var tmp_3 = matchedGuideChannel$lambda_0(guide, feeds, channel);
    // Inline function 'kotlin.text.orEmpty' call
    var tmp0_elvis_lhs_0 = tmp.chooseFeed_zg3jva_k$(tmp_0, tmp_1, tmp_2, tmp_3, matchedGuideChannel$lambda_1(feeds));
    return tmp0_elvis_lhs_0 == null ? '' : tmp0_elvis_lhs_0;
  }
  function shiftBrowserGuide(entries, hours) {
    var shift = GuideProgrammeRules_instance.browserShift_mvpua4_k$(hours);
    if (shift === 0.0)
      return entries;
    // Inline function 'kotlin.collections.map' call
    var this_0 = guideArray(entries);
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(this_0.length);
    var inductionVariable = 0;
    var last = this_0.length;
    while (inductionVariable < last) {
      var item = this_0[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var row = {};
      // Inline function 'kotlin.collections.forEach' call
      var indexedObject = guideKeys(item);
      var inductionVariable_0 = 0;
      var last_0 = indexedObject.length;
      while (inductionVariable_0 < last_0) {
        var element = indexedObject[inductionVariable_0];
        inductionVariable_0 = inductionVariable_0 + 1 | 0;
        row[element] = item[element];
      }
      row.start = row.start + shift;
      row.end = row.end + shift;
      destination.add_utx5q5_k$(row);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    return copyToArray(destination);
  }
  function lookup$field(rows, index, name) {
    var row = rows[index];
    var value = row == null ? null : row[name];
    var tmp;
    if (typeof value === 'number') {
      // Inline function 'kotlin.js.unsafeCast' call
      tmp = value;
    } else {
      tmp = NaN;
    }
    return tmp;
  }
  function BrowserGuideLookup$lookup$lambda($rows) {
    return function (it) {
      return lookup$field($rows, it, 'start');
    };
  }
  function BrowserGuideLookup$lookup$lambda_0($rows) {
    return function (it) {
      return lookup$field($rows, it, 'end');
    };
  }
  function BrowserGuideLookup(limit, entryLimit) {
    this.cache_1 = new GuideLookupCache(limit, entryLimit);
    this.source_1 = null;
  }
  protoOf(BrowserGuideLookup).clear = function () {
    this.source_1 = null;
    this.cache_1.clear_j9egeb_k$();
  };
  protoOf(BrowserGuideLookup).lookup = function (key, guide, now, materialize) {
    if (this.source_1 !== guide) {
      this.clear();
      this.source_1 = guide;
    }
    var tmp0_elvis_lhs = this.cache_1.get_wei43m_k$(key);
    var tmp;
    if (tmp0_elvis_lhs == null) {
      // Inline function 'kotlin.also' call
      var this_0 = new BrowserLookupItem(materialize());
      var entries = this_0.value_1.entries;
      var tmp_0;
      if (entries === this_0.value_1.unshifted) {
        tmp_0 = 0;
      } else {
        // Inline function 'kotlin.js.unsafeCast' call
        tmp_0 = entries.length;
      }
      this.cache_1.put_y44h9a_k$(key, this_0, tmp_0);
      tmp = this_0;
    } else {
      tmp = tmp0_elvis_lhs;
    }
    var item = tmp;
    var rows = item.value_1.entries;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp_1 = rows.length;
    var tmp_2 = BrowserGuideLookup$lookup$lambda(rows);
    var selected = item.schedule_1.select_d15kz8_k$(tmp_1, tmp_2, BrowserGuideLookup$lookup$lambda_0(rows), now);
    var result = {};
    result.metadata = item.value_1.metadata;
    result.entries = rows;
    result.current = selected.current_1 < 0 ? null : rows[selected.current_1];
    result.next = selected.next_1 < 0 ? null : rows[selected.next_1];
    return result;
  };
  function legacyGuideSelection(rows, now, nextCount) {
    var values = guideArray(rows);
    var tmp = LegacyGuideSchedule_instance;
    var tmp_0 = values.length;
    var tmp_1 = legacyGuideSelection$lambda(values);
    var selected = tmp.select_q0a6x2_k$(tmp_0, tmp_1, legacyGuideSelection$lambda_0(values), now, nextCount);
    var result = {};
    result.current = selected.current_1 < 0 ? null : values[selected.current_1];
    // Inline function 'kotlin.collections.map' call
    var this_0 = selected.following_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = values[item];
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.following = copyToArray(destination);
    result.retryAt = selected.retryAt_1;
    return result;
  }
  function legacyGuideShift(rows, shift) {
    if (!(typeof shift === 'number'))
      return rows;
    // Inline function 'kotlin.collections.forEach' call
    var indexedObject = guideArray(rows);
    var inductionVariable = 0;
    var last = indexedObject.length;
    while (inductionVariable < last) {
      var element = indexedObject[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var tmp;
      if (element != null) {
        var tmp_0 = GuideProgrammeRules_instance;
        // Inline function 'kotlin.js.unsafeCast' call
        tmp = tmp_0.legacyShift_98wu3x_k$(shift, wire(element.time).number_h3u0fr_k$(), wire(element.time_to).number_h3u0fr_k$());
      } else {
        tmp = false;
      }
      if (tmp) {
        element.time = element.time + shift;
        element.time_to = element.time_to + shift;
      }
    }
    return rows;
  }
  function legacyGuideCacheCapacity(value) {
    return GuideResponseCache_instance.capacity_u8oxzg_k$(value);
  }
  function legacyGuideCacheRead(rows, fetched, capacity, clock) {
    var values = guideArray(rows);
    var tmp = GuideResponseCache_instance;
    var tmp_0 = values.length;
    var tmp_1 = typeof fetched === 'undefined' ? null : wire(fetched).number_h3u0fr_k$();
    return tmp.read_dhesoo_k$(capacity, tmp_0, tmp_1, legacyGuideCacheRead$lambda(values), clock);
  }
  function legacyGuideCacheOrder(order, id, limit, remove) {
    var _destruct__k2r9zo = GuideResponseCache_instance.touch_xfw5md_k$(toList(order), id, limit, remove);
    var retained = _destruct__k2r9zo.component1_7eebsc_k$();
    var evicted = _destruct__k2r9zo.component2_7eebsb_k$();
    var target = order;
    target.length = 0;
    // Inline function 'kotlin.collections.forEach' call
    var _iterator__ex2g4s = retained.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s.next_20eer_k$();
      target.push(element);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    return copyToArray(evicted);
  }
  function guideText(value) {
    var tmp;
    if (value == null) {
      tmp = '';
    } else {
      // Inline function 'kotlin.js.unsafeCast' call
      tmp = String(value);
    }
    return tmp;
  }
  function guideArray(value) {
    var tmp;
    if (value == null) {
      // Inline function 'kotlin.emptyArray' call
      tmp = [];
    } else {
      // Inline function 'kotlin.js.unsafeCast' call
      tmp = value;
    }
    return tmp;
  }
  function guideKeys(value) {
    var tmp;
    if (value == null) {
      // Inline function 'kotlin.emptyArray' call
      tmp = [];
    } else {
      // Inline function 'kotlin.js.unsafeCast' call
      tmp = Object.keys(value);
    }
    return tmp;
  }
  function guideOwn(value, key) {
    var tmp;
    if (value != null) {
      // Inline function 'kotlin.js.unsafeCast' call
      tmp = Object.prototype.hasOwnProperty.call(value, key);
    } else {
      tmp = false;
    }
    return tmp;
  }
  function dictionary() {
    return Object.create(null);
  }
  function coverage(value) {
    var result = {};
    result.limited = value.limited_1;
    result.windowStart = value.windowStart_1;
    result.windowEnd = value.windowEnd_1;
    result.programmeLimit = value.programmeLimit_1;
    result.truncatedChannels = value.truncatedChannels_1;
    return result;
  }
  function station($this, value) {
    // Inline function 'kotlin.js.unsafeCast' call
    if ($this.stations_1.has(value))
      return $this.stations_1.get(value);
    var result = {};
    result.id = value.id_1;
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_0 = value.names_1;
    result.names = copyToArray(this_0);
    result.logo = value.logo_1;
    if (!(value.sourceUrl_1 == null))
      result.sourceUrl = value.sourceUrl_1;
    $this.stations_1.set(value, result);
    return result;
  }
  function GuideModels(programme) {
    this.programme_1 = programme;
    this.stations_1 = new Map();
    this.schedules_1 = new Map();
  }
  protoOf(GuideModels).catalog_20ss23_k$ = function (value) {
    var result = {};
    // Inline function 'kotlin.collections.map' call
    var this_0 = value.channels_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = station(this, item);
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.channels = copyToArray(destination);
    var tmp0 = value.programmes_1;
    // Inline function 'kotlin.collections.map' call
    var transform = this.programme_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination_0 = ArrayList_init_$Create$_0(collectionSizeOrDefault(tmp0, 10));
    var _iterator__ex2g4s_0 = tmp0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var item_0 = _iterator__ex2g4s_0.next_20eer_k$();
      destination_0.add_utx5q5_k$(transform(item_0));
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.programmes = copyToArray(destination_0);
    result.byId = dictionary();
    result.byChannel = dictionary();
    result.byName = dictionary();
    result.byAlias = dictionary();
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_1 = value.byId_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s_1.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var key = element.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var row = element.get_value_j01efc_k$();
      result.byId[key] = station(this, row);
    }
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_2 = value.byChannel_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
      var element_0 = _iterator__ex2g4s_2.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var key_0 = element_0.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var rows = element_0.get_value_j01efc_k$();
      // Inline function 'kotlin.js.unsafeCast' call
      if (!this.schedules_1.has(rows)) {
        // Inline function 'kotlin.collections.map' call
        var transform_0 = this.programme_1;
        // Inline function 'kotlin.collections.mapTo' call
        var destination_1 = ArrayList_init_$Create$_0(collectionSizeOrDefault(rows, 10));
        var _iterator__ex2g4s_3 = rows.iterator_jk1svi_k$();
        while (_iterator__ex2g4s_3.hasNext_bitz1p_k$()) {
          var item_1 = _iterator__ex2g4s_3.next_20eer_k$();
          destination_1.add_utx5q5_k$(transform_0(item_1));
        }
        // Inline function 'kotlin.collections.toTypedArray' call
        var tmp$ret$20 = copyToArray(destination_1);
        this.schedules_1.set(rows, tmp$ret$20);
      }
      result.byChannel[key_0] = this.schedules_1.get(rows);
    }
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_4 = value.byName_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_4.hasNext_bitz1p_k$()) {
      var element_1 = _iterator__ex2g4s_4.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var key_1 = element_1.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var ids = element_1.get_value_j01efc_k$();
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp$ret$26 = copyToArray(ids);
      result.byName[key_1] = tmp$ret$26;
    }
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_5 = value.byAlias_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_5.hasNext_bitz1p_k$()) {
      var element_2 = _iterator__ex2g4s_5.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var key_2 = element_2.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var ids_0 = element_2.get_value_j01efc_k$();
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp$ret$32 = copyToArray(ids_0);
      result.byAlias[key_2] = tmp$ret$32;
    }
    return result;
  };
  function BrowserLookupItem(value) {
    this.value_1 = value;
    this.schedule_1 = new GuideScheduleMemo();
  }
  function parseBrowserGuide$lambda($records) {
    return function (row) {
      var tmp0 = $records;
      // Inline function 'kotlin.collections.getOrPut' call
      var key = row.slot_1;
      var value = tmp0.get_wei43m_k$(key);
      var tmp;
      if (value == null) {
        var value_0 = {};
        value_0.channelId = row.channelId_1;
        value_0.start = row.start_1;
        value_0.end = row.end_1;
        value_0.title = row.title_1;
        value_0.description = row.description_1;
        value_0.catchupId = row.catchupId_1;
        var answer = value_0;
        tmp0.put_4fpzoq_k$(key, answer);
        tmp = answer;
      } else {
        tmp = value;
      }
      return tmp;
    };
  }
  function mergeBrowserGuides$lambda(feed, id) {
    // Inline function 'kotlin.js.unsafeCast' call
    return JSON.stringify([feed, id]);
  }
  function mergeBrowserGuides$lambda_0($payloads) {
    return function (it) {
      return $payloads.get_c1px32_k$(it.slot_1);
    };
  }
  function matchedGuideChannel$plain$lambda($value) {
    return function (id) {
      var tmp;
      if ($value.byRawId != null) {
        var tmp_0;
        if (guideOwn($value.byRawId, id)) {
          // Inline function 'kotlin.collections.map' call
          var this_0 = guideArray($value.byRawId[id]);
          // Inline function 'kotlin.collections.mapTo' call
          var destination = ArrayList_init_$Create$_0(this_0.length);
          var inductionVariable = 0;
          var last = this_0.length;
          while (inductionVariable < last) {
            var item = this_0[inductionVariable];
            inductionVariable = inductionVariable + 1 | 0;
            var tmp$ret$2 = guideText(item);
            destination.add_utx5q5_k$(tmp$ret$2);
          }
          tmp_0 = destination;
        } else {
          tmp_0 = emptyList();
        }
        tmp = tmp_0;
      } else if (guideOwn($value.byChannel, id)) {
        tmp = listOf(id);
      } else {
        tmp = emptyList();
      }
      return tmp;
    };
  }
  function matchedGuideChannel$plain$lambda_0($value) {
    return function (alias, key) {
      var map = alias ? $value.byAlias : $value.byName;
      var tmp;
      if (guideOwn(map, key)) {
        // Inline function 'kotlin.collections.map' call
        var this_0 = guideArray(map[key]);
        // Inline function 'kotlin.collections.mapTo' call
        var destination = ArrayList_init_$Create$_0(this_0.length);
        var inductionVariable = 0;
        var last = this_0.length;
        while (inductionVariable < last) {
          var item = this_0[inductionVariable];
          inductionVariable = inductionVariable + 1 | 0;
          var tmp$ret$2 = guideText(item);
          destination.add_utx5q5_k$(tmp$ret$2);
        }
        tmp = destination;
      } else {
        tmp = emptyList();
      }
      return tmp;
    };
  }
  function matchedGuideChannel$plain$lambda_1($value) {
    return function (it) {
      return guideOwn($value.byChannel, it);
    };
  }
  function matchedGuideChannel$plain($channel, value, namesOnly) {
    if (value == null || value.byChannel == null)
      return null;
    var tmp = GuideFeeds_getInstance();
    var tmp_0 = guideText($channel == null ? null : $channel.tvgId);
    var tmp_1 = guideText($channel == null ? null : $channel.tvgName);
    var tmp_2 = listOf_0([tmp_1, guideText($channel == null ? null : $channel.name)]);
    var tmp_3 = matchedGuideChannel$plain$lambda(value);
    var tmp_4 = matchedGuideChannel$plain$lambda_0(value);
    return tmp.choose_jx1efi_k$(tmp_0, tmp_2, namesOnly, tmp_3, tmp_4, matchedGuideChannel$plain$lambda_1(value));
  }
  function matchedGuideChannel$lambda($feeds) {
    return function (it) {
      return guideText($feeds[it].sourceUrl);
    };
  }
  function matchedGuideChannel$lambda_0($guide, $feeds, $channel) {
    return function (index, namesOnly) {
      return matchedGuideChannel$plain($channel, index < 0 ? $guide : $feeds[index].guide, namesOnly);
    };
  }
  function matchedGuideChannel$lambda_1($feeds) {
    return function (index, id) {
      return guideText($feeds[index].keys[id]);
    };
  }
  function legacyGuideSelection$lambda($values) {
    return function (it) {
      return wire($values[it].time).number_h3u0fr_k$();
    };
  }
  function legacyGuideSelection$lambda_0($values) {
    return function (it) {
      return wire($values[it].time_to).number_h3u0fr_k$();
    };
  }
  function legacyGuideCacheRead$lambda($values) {
    return function (it) {
      return wire($values[it].time_to).number_h3u0fr_k$();
    };
  }
  function nativeGuideSources(supplied, single, trim, identity) {
    identity = identity === VOID ? null : identity;
    var tmp = NativeGuideSources_instance;
    var tmp_0 = toList(supplied);
    var tmp_1 = NativeSourceFormat_SWIFT_getInstance();
    var tmp_2;
    if (identity == null) {
      tmp_2 = nativeGuideSources$lambda;
    } else {
      tmp_2 = identity;
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_0 = tmp.urls_6o027a_k$(tmp_0, single, true, tmp_1, trim, tmp_2);
    return copyToArray(this_0);
  }
  function nativeGuideUnowned(existing, incoming, identity) {
    identity = identity === VOID ? null : identity;
    var tmp = NativeGuideSources_instance;
    var tmp_0 = toList(existing);
    var tmp_1 = toList(incoming);
    var tmp_2;
    if (identity == null) {
      tmp_2 = nativeGuideUnowned$lambda;
    } else {
      tmp_2 = identity;
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_0 = tmp.unowned_jpm54w_k$(tmp_0, tmp_1, tmp_2);
    return copyToArray(this_0);
  }
  function nativeGuideLookup(now, fetched, force, pending) {
    return NativeGuideSources_instance.lookup_lo9ey9_k$(now, fetched, force, pending).name_1;
  }
  function nativeGuideDisk(source, storedSource, now, fetched, stale) {
    return NativeGuideSources_instance.diskSwift_wifyxd_k$(source, storedSource, now, fetched, stale);
  }
  function nativeGuideFresh(age) {
    return NativeGuideSources_instance.fresh_w660h4_k$(age);
  }
  function nativeGuideRefresh(failed, empty, stale) {
    return NativeGuideSources_instance.refresh_lm5uba_k$(failed, empty, stale).name_1;
  }
  function nativeGuideEvictSourceSet(count, existing) {
    return NativeGuideSources_instance.evictSourceSet_idede3_k$(count, existing);
  }
  function nativeGuideLoadStart(force) {
    return NativeSourceLoad_instance.start_4vcdj7_k$(force).name_1;
  }
  function nativeGuideLoadNext(action, succeeded, channels, format) {
    var tmp = NativeSourceLoad_instance;
    var tmp_0 = valueOf(action);
    var tmp_1;
    switch (format) {
      case 'swift':
        tmp_1 = NativeSourceFormat_SWIFT_getInstance();
        break;
      case 'android':
        tmp_1 = NativeSourceFormat_ANDROID_getInstance();
        break;
      default:
        // Inline function 'kotlin.error' call

        var message = 'Unknown native source format';
        throw IllegalStateException_init_$Create$_0(toString_1(message));
    }
    return tmp.next_ryrxq3_k$(tmp_0, succeeded, channels, tmp_1).name_1;
  }
  function NativeGuideSourceBatch(count) {
    this.batch_1 = new NativeSourceBatch(count);
  }
  protoOf(NativeGuideSourceBatch).next = function () {
    return this.batch_1.next_20eer_k$();
  };
  protoOf(NativeGuideSourceBatch).advance = function (succeeded, channels) {
    return this.batch_1.advance_cfek05_k$(succeeded, channels);
  };
  protoOf(NativeGuideSourceBatch).failure = function () {
    return this.batch_1.failure_hyx20m_k$();
  };
  function nativeGuideSources$lambda(it) {
    return it;
  }
  function nativeGuideUnowned$lambda(it) {
    return it;
  }
  function wire(value) {
    var tmp;
    if (typeof value === 'undefined') {
      tmp = Companion_getInstance_13().missing_1;
    } else {
      if (value == null) {
        tmp = Companion_getInstance_13().nil_1;
      } else {
        if (typeof value === 'string') {
          var tmp_0 = Companion_getInstance_13();
          // Inline function 'kotlin.js.unsafeCast' call
          tmp = tmp_0.text_yxj031_k$(value);
        } else {
          if (typeof value === 'number') {
            var tmp_1 = ProviderValueKind_NUMBER_getInstance();
            // Inline function 'kotlin.js.unsafeCast' call
            var tmp$ret$1 = String(value);
            tmp = new ProviderValue(tmp_1, tmp$ret$1);
          } else {
            if (typeof value === 'boolean') {
              var tmp_2 = ProviderValueKind_BOOLEAN_getInstance();
              // Inline function 'kotlin.js.unsafeCast' call
              var tmp$ret$2 = String(value);
              tmp = new ProviderValue(tmp_2, tmp$ret$2);
            } else {
              // Inline function 'kotlin.js.unsafeCast' call
              if (Array.isArray(value)) {
                var tmp_3 = Companion_getInstance_13();
                // Inline function 'kotlin.js.unsafeCast' call
                var tmp$ret$4 = value.length;
                // Inline function 'kotlin.collections.map' call
                var this_0 = until(0, tmp$ret$4);
                // Inline function 'kotlin.collections.mapTo' call
                var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
                var inductionVariable = this_0.first_1;
                var last = this_0.last_1;
                if (inductionVariable <= last)
                  do {
                    var item = inductionVariable;
                    inductionVariable = inductionVariable + 1 | 0;
                    var it = item;
                    var tmp$ret$7 = wire(value[it]);
                    destination.add_utx5q5_k$(tmp$ret$7);
                  }
                   while (!(item === last));
                tmp = tmp_3.array_vqz2lg_k$(destination);
              } else {
                var tmp_4 = Companion_getInstance_13();
                // Inline function 'kotlin.js.unsafeCast' call
                // Inline function 'kotlin.collections.associateWith' call
                var this_1 = Object.keys(value);
                var result = LinkedHashMap_init_$Create$_0(coerceAtLeast(mapCapacity(this_1.length), 16));
                // Inline function 'kotlin.collections.associateWithTo' call
                var inductionVariable_0 = 0;
                var last_0 = this_1.length;
                while (inductionVariable_0 < last_0) {
                  var element = this_1[inductionVariable_0];
                  inductionVariable_0 = inductionVariable_0 + 1 | 0;
                  var tmp$ret$11 = wire(value[element]);
                  result.put_4fpzoq_k$(element, tmp$ret$11);
                }
                tmp = tmp_4.obj_60q8ki_k$(result);
              }
            }
          }
        }
      }
    }
    return tmp;
  }
  function unwire(value) {
    var tmp;
    switch (value.kind_1.ordinal_1) {
      case 0:
        tmp = undefined;
        break;
      case 1:
        tmp = null;
        break;
      case 2:
        tmp = value.scalar_1;
        break;
      case 3:
        tmp = toDouble(value.scalar_1);
        break;
      case 4:
        tmp = value.scalar_1 === 'true';
        break;
      case 5:
        // Inline function 'kotlin.collections.map' call

        var this_0 = value.elements_1;
        // Inline function 'kotlin.collections.mapTo' call

        var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
        var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
        while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
          var item = _iterator__ex2g4s.next_20eer_k$();
          var tmp$ret$2 = unwire(item);
          destination.add_utx5q5_k$(tmp$ret$2);
        }

        // Inline function 'kotlin.collections.toTypedArray' call

        tmp = copyToArray(destination);
        break;
      case 6:
        var result = {};
        // Inline function 'kotlin.collections.forEach' call

        // Inline function 'kotlin.collections.iterator' call

        var _iterator__ex2g4s_0 = value.properties_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
        while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
          var element = _iterator__ex2g4s_0.next_20eer_k$();
          // Inline function 'kotlin.collections.component1' call
          var key = element.get_key_18j28a_k$();
          // Inline function 'kotlin.collections.component2' call
          var entry = element.get_value_j01efc_k$();
          var property = {writable: true, enumerable: true, configurable: true};
          property.value = unwire(entry);
          Object.defineProperty(result, key, property);
        }

        tmp = result;
        break;
      default:
        noWhenBranchMatchedException();
        break;
    }
    return tmp;
  }
  function failure(code) {
    var result = {};
    result.failure = code;
    return result;
  }
  function legacyChannel(name, epg, category, group, logo, url, mode, hours) {
    mode = mode === VOID ? '' : mode;
    hours = hours === VOID ? 0.0 : hours;
    var row = {};
    row.ca = mode;
    row.caso = '';
    row.category = {};
    row.category.class = category;
    row.category.name = group;
    row.channel_name = unwire(name);
    row.epg = epg;
    row.logo = unwire(logo);
    row.rec = hours;
    row.time = 0;
    row.time_to = 0;
    row.tn = unwire(name);
    row.url = url;
    return row;
  }
  function legacyGuide(rows) {
    var tmp;
    if (rows == null) {
      tmp = null;
    } else {
      // Inline function 'kotlin.collections.map' call
      // Inline function 'kotlin.collections.mapTo' call
      var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(rows, 10));
      var _iterator__ex2g4s = rows.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var item = _iterator__ex2g4s.next_20eer_k$();
        var row = {};
        row.name = unwire(item.name_1);
        row.descr = unwire(item.description_1);
        row.time = item.start_1;
        row.time_to = item.end_1;
        row.icon = '';
        destination.add_utx5q5_k$(row);
      }
      tmp = destination;
    }
    var tmp1_safe_receiver = tmp;
    var tmp_0;
    if (tmp1_safe_receiver == null) {
      tmp_0 = null;
    } else {
      // Inline function 'kotlin.collections.toTypedArray' call
      tmp_0 = copyToArray(tmp1_safe_receiver);
    }
    return tmp_0;
  }
  function stalkerTextDenied(value) {
    return StalkerProtocol_instance.textDenied_kpfuc2_k$(value);
  }
  function stalkerConfig(input) {
    var tmp;
    try {
      var config = wire(input);
      var location = StalkerProtocol_instance.browserConfiguration_wa9ah_k$(config.get_6bo4tg_k$('url').string_er2cq7_k$(), config.get_6bo4tg_k$('mac').string_er2cq7_k$(), config.get_6bo4tg_k$('profile'));
      var result = {};
      result.endpoint = location.endpoint_1;
      result.referer = location.referer_1;
      var tmp_0 = location.endpoint_1 + '\n' + config.get_6bo4tg_k$('mac').string_er2cq7_k$() + '\n';
      // Inline function 'kotlin.js.unsafeCast' call
      result.fingerprint = tmp_0 + JSON.stringify(input.profile);
      tmp = result;
    } catch ($p) {
      var tmp_1;
      if ($p instanceof StalkerFailure) {
        var error = $p;
        tmp_1 = failure(error.code_1);
      } else {
        throw $p;
      }
      tmp = tmp_1;
    }
    return tmp;
  }
  function operation($this, value) {
    var result = {};
    result.request = StalkerClient$operation$lambda(value, $this);
    result.accept = StalkerClient$operation$lambda_0(value);
    result.result = StalkerClient$operation$lambda_1(value, $this);
    return result;
  }
  function item($this, value) {
    var result = {};
    result.id = value.id_1;
    result.name = value.name_1;
    result.kind = value.kind_1;
    result.group = value.group_1;
    result.sourceId = $this.session_1.source_1;
    result.portalGeneration = $this.session_1.generation_1;
    if (value.folder_1 === 'portal-vod') {
      result.folderType = value.folder_1;
      return result;
    }
    result.adult = value.adult_1;
    if (value.folder_1 === 'portal-category') {
      result.folderType = value.folder_1;
      result.categoryId = unwire(value.category_1);
      return result;
    }
    result.provider = 'stalker';
    result.logo = value.logo_1;
    result.tvgId = value.epgId_1;
    result.description = value.description_1;
    // Inline function 'kotlin.text.isNotEmpty' call
    var this_0 = value.folder_1;
    if (charSequenceLength(this_0) > 0) {
      result.folderType = value.folder_1;
      result.movieId = unwire(value.movie_1);
      result.seasonId = unwire(value.season_1);
      result.episodeId = unwire(value.episode_1);
      result.categoryId = unwire(value.category_1);
    }
    return result;
  }
  function StalkerClient$operation$lambda$lambda(this$0) {
    return function (it) {
      return this$0.component_1(it.first_1) + '=' + this$0.component_1(it.second_1);
    };
  }
  function StalkerClient$operation$lambda($value, this$0) {
    return function () {
      var tmp0_safe_receiver = $value.get_request_jdwg4m_k$();
      var tmp;
      if (tmp0_safe_receiver == null) {
        tmp = null;
      } else {
        // Inline function 'kotlin.let' call
        var outgoing = {};
        var tmp_0 = this$0.config_1.get_6bo4tg_k$('endpoint').string_er2cq7_k$() + '?';
        var tmp_1 = StalkerProtocol_instance.query_vqjnuh_k$(tmp0_safe_receiver, StalkerFormat_BROWSER_getInstance());
        outgoing.url = tmp_0 + joinToString_0(tmp_1, '&', VOID, VOID, VOID, VOID, StalkerClient$operation$lambda$lambda(this$0));
        outgoing.headers = {};
        // Inline function 'kotlin.collections.forEach' call
        // Inline function 'kotlin.collections.iterator' call
        var _iterator__ex2g4s = StalkerProtocol_instance.headers_parquy_k$(this$0.config_1.get_6bo4tg_k$('mac').string_er2cq7_k$(), this$0.config_1.get_6bo4tg_k$('language').string_er2cq7_k$(), this$0.config_1.get_6bo4tg_k$('timezone').string_er2cq7_k$(), this$0.config_1.get_6bo4tg_k$('profile'), this$0.session_1.token_1, new StalkerLocation(this$0.config_1.get_6bo4tg_k$('endpoint').string_er2cq7_k$(), this$0.config_1.get_6bo4tg_k$('referer').string_er2cq7_k$()), StalkerFormat_BROWSER_getInstance(), this$0.component_1).get_entries_p20ztl_k$().iterator_jk1svi_k$();
        while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
          var element = _iterator__ex2g4s.next_20eer_k$();
          // Inline function 'kotlin.collections.component1' call
          var key = element.get_key_18j28a_k$();
          // Inline function 'kotlin.collections.component2' call
          var v = element.get_value_j01efc_k$();
          outgoing.headers[key] = v;
        }
        tmp = outgoing;
      }
      return tmp;
    };
  }
  function StalkerClient$operation$lambda_0($value) {
    return function (response) {
      var tmp;
      try {
        $value.accept_wd2l5t_k$(wire(response));
        tmp = null;
      } catch ($p) {
        var tmp_0;
        if ($p instanceof StalkerFailure) {
          var error = $p;
          tmp_0 = failure(error.code_1);
        } else {
          throw $p;
        }
        tmp = tmp_0;
      }
      return tmp;
    };
  }
  function StalkerClient$operation$lambda_1($value, this$0) {
    return function () {
      var output = {};
      var tmp;
      if (!($value.url_1 == null)) {
        tmp = output.url = $value.url_1;
      } else {
        // Inline function 'kotlin.requireNotNull' call
        var tmp0 = $value.result_1;
        var tmp$ret$1;
        $l$block: {
          // Inline function 'kotlin.requireNotNull' call
          if (tmp0 == null) {
            var message = 'Required value was null.';
            throw IllegalArgumentException_init_$Create$_0(toString_1(message));
          } else {
            tmp$ret$1 = tmp0;
            break $l$block;
          }
        }
        var catalog = tmp$ret$1;
        // Inline function 'kotlin.collections.map' call
        var this_0 = catalog.items_1;
        // Inline function 'kotlin.collections.mapTo' call
        var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
        var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
        while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
          var item_0 = _iterator__ex2g4s.next_20eer_k$();
          var tmp$ret$5 = item(this$0, item_0);
          destination.add_utx5q5_k$(tmp$ret$5);
        }
        // Inline function 'kotlin.collections.toTypedArray' call
        var items = copyToArray(destination);
        if (catalog.catalog_1) {
          output.channels = items;
          // Inline function 'kotlin.emptyArray' call
          output.epgUrls = [];
        } else
          output.items = items;
        // Inline function 'kotlin.collections.toTypedArray' call
        var this_1 = catalog.warnings_1;
        tmp = output.warnings = copyToArray(this_1);
      }
      return output;
    };
  }
  function StalkerClient(input, generation, component, relative, absolute) {
    this.component_1 = component;
    this.config_1 = wire(input);
    this.session_1 = new StalkerBrowserSession(this.config_1.get_6bo4tg_k$('id').string_er2cq7_k$(), generation, this.config_1.get_6bo4tg_k$('fingerprint').string_er2cq7_k$(), this.component_1, relative, absolute);
  }
  protoOf(StalkerClient).verify = function (fingerprint) {
    var tmp;
    try {
      this.session_1.verify_r6shw1_k$(fingerprint);
      tmp = null;
    } catch ($p) {
      var tmp_0;
      if ($p instanceof StalkerFailure) {
        var error = $p;
        tmp_0 = failure(error.code_1);
      } else {
        throw $p;
      }
      tmp = tmp_0;
    }
    return tmp;
  };
  protoOf(StalkerClient).load = function () {
    return operation(this, this.session_1.load_ks1tnz_k$(this.config_1.get_6bo4tg_k$('profile')));
  };
  protoOf(StalkerClient).browse = function (node) {
    var tmp;
    try {
      tmp = operation(this, this.session_1.browse_ar72c3_k$(wire(node)));
    } catch ($p) {
      var tmp_0;
      if ($p instanceof StalkerFailure) {
        var error = $p;
        tmp_0 = failure(error.code_1);
      } else {
        throw $p;
      }
      tmp = tmp_0;
    }
    return tmp;
  };
  protoOf(StalkerClient).playback = function (node) {
    var tmp;
    try {
      tmp = operation(this, this.session_1.playback_dhnsfw_k$(wire(node)));
    } catch ($p) {
      var tmp_0;
      if ($p instanceof StalkerFailure) {
        var error = $p;
        tmp_0 = failure(error.code_1);
      } else {
        throw $p;
      }
      tmp = tmp_0;
    }
    return tmp;
  };
  function LegacyStalkerClient$catalog$lambda($hash) {
    return function (it) {
      return $hash(unwire(it));
    };
  }
  function LegacyStalkerClient(portal, mac) {
    this.core_1 = new LegacyStalker(portal, mac);
  }
  protoOf(LegacyStalkerClient).endpoint = function () {
    return this.core_1.get_endpoint_30bvdu_k$();
  };
  protoOf(LegacyStalkerClient).api = function (method, params) {
    return unwire(this.core_1.api_ph4tw9_k$(method, wire(params).properties_1));
  };
  protoOf(LegacyStalkerClient).request = function () {
    var tmp0_safe_receiver = this.core_1.get_request_jdwg4m_k$();
    var tmp;
    if (tmp0_safe_receiver == null) {
      tmp = null;
    } else {
      // Inline function 'kotlin.let' call
      tmp = unwire(tmp0_safe_receiver);
    }
    return tmp;
  };
  protoOf(LegacyStalkerClient).accept = function (response) {
    var tmp;
    try {
      this.core_1.accept_wd2l5t_k$(wire(response));
      tmp = null;
    } catch ($p) {
      var tmp_0;
      if ($p instanceof StalkerFailure) {
        var error = $p;
        tmp_0 = failure(error.code_1);
      } else {
        throw $p;
      }
      tmp = tmp_0;
    }
    return tmp;
  };
  protoOf(LegacyStalkerClient).catalog = function (hash) {
    var catalog = this.core_1.catalog_rtev1h_k$(LegacyStalkerClient$catalog$lambda(hash));
    var result = {};
    // Inline function 'kotlin.collections.map' call
    var this_0 = catalog.entries_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = item.id_1;
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.ids = copyToArray(destination);
    result.channels = Object.create(null);
    result.groups = Object.create(null);
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_1 = catalog.groups_1.get_keys_wop4xp_k$();
    result.groupOrder = copyToArray(this_1);
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_0 = catalog.groups_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s_0.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var key = element.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var ids = element.get_value_j01efc_k$();
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp$ret$10 = copyToArray(ids);
      result.groups[key] = tmp$ret$10;
    }
    // Inline function 'kotlin.collections.forEach' call
    var _iterator__ex2g4s_1 = catalog.entries_1.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
      var element_0 = _iterator__ex2g4s_1.next_20eer_k$();
      result.channels[element_0.id_1] = legacyChannel(element_0.name_1, element_0.epg_1, element_0.category_1, element_0.group_1, element_0.logo_1, unwire(element_0.url_1), element_0.mode_1, element_0.hours_1);
    }
    return result;
  };
  protoOf(LegacyStalkerClient).guideRequest = function (channel, clock) {
    return unwire(this.core_1.guideRequest_82b3gw_k$(wire(channel), clock));
  };
  protoOf(LegacyStalkerClient).guide = function (response) {
    return legacyGuide(this.core_1.guide_lhn7f_k$(wire(response)));
  };
  function streamingGuideIdentities(rows) {
    var tmp = Companion_instance_14;
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(rows.length);
    var inductionVariable = 0;
    var last = rows.length;
    while (inductionVariable < last) {
      var item = rows[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      var tmp0_elvis_lhs = item.tvgId;
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp_0 = tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs;
      var tmp1_elvis_lhs = item.tvgName;
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp_1 = tmp1_elvis_lhs == null ? '' : tmp1_elvis_lhs;
      var tmp2_elvis_lhs = item.name;
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp_2 = tmp2_elvis_lhs == null ? '' : tmp2_elvis_lhs;
      var tmp3_elvis_lhs = item.archiveDays;
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp$ret$7 = tmp3_elvis_lhs == null ? 0.0 : tmp3_elvis_lhs;
      var tmp$ret$3 = new StreamingGuideIdentity(tmp_0, tmp_1, tmp_2, tmp$ret$7);
      destination.add_utx5q5_k$(tmp$ret$3);
    }
    // Inline function 'kotlin.collections.map' call
    var this_0 = tmp.identities_h380h1_k$(destination);
    // Inline function 'kotlin.collections.mapTo' call
    var destination_0 = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item_0 = _iterator__ex2g4s.next_20eer_k$();
      // Inline function 'kotlin.arrayOf' call
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      var tmp$ret$10 = [item_0.id_1, item_0.tvgName_1, item_0.name_1, item_0.days_1];
      destination_0.add_utx5q5_k$(tmp$ret$10);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    return copyToArray(destination_0);
  }
  function StreamingGuideFilter$output$lambda($channel) {
    return function (it) {
      // Inline function 'kotlin.collections.toTypedArray' call
      var this_0 = it.names_1;
      var tmp$ret$0 = copyToArray(this_0);
      return $channel(it.id_1, tmp$ret$0, it.logo_1);
    };
  }
  function StreamingGuideFilter(requested, clock, programmeLimit, perChannel) {
    var tmp = this;
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.collections.map' call
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(requested.length);
    var inductionVariable = 0;
    var last = requested.length;
    while (inductionVariable < last) {
      var item = requested[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp_0 = item[0];
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp_1 = item[1];
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp_2 = item[2];
      // Inline function 'kotlin.js.unsafeCast' call
      var tmp$ret$7 = item[3];
      var tmp$ret$3 = new StreamingGuideIdentity(tmp_0, tmp_1, tmp_2, tmp$ret$7);
      destination.add_utx5q5_k$(tmp$ret$3);
    }
    tmp.guide_1 = new StreamingGuide(destination, clock, programmeLimit, perChannel);
  }
  protoOf(StreamingGuideFilter).channel = function (id, names, icon) {
    return this.guide_1.channel_c4n2uz_k$(id, toList(names), icon);
  };
  protoOf(StreamingGuideFilter).accepts = function (id, start, end) {
    return this.guide_1.accepts_pt7gjr_k$(id, start, end);
  };
  protoOf(StreamingGuideFilter).programme = function (id, start, end, payload) {
    // Inline function 'kotlin.js.unsafeCast' call
    return this.guide_1.programme_4t147i_k$(id, start, end, payload);
  };
  protoOf(StreamingGuideFilter).output = function (limit, channel, programme, bytes, emit) {
    var tmp0_elvis_lhs = this.guide_1.output_ll6xq7_k$(limit, StreamingGuideFilter$output$lambda(channel), programme, bytes, emit);
    var tmp;
    if (tmp0_elvis_lhs == null) {
      return null;
    } else {
      tmp = tmp0_elvis_lhs;
    }
    var coverage = tmp;
    var result = {};
    result.start = coverage.start_1;
    result.end = coverage.end_1;
    result.programmeLimit = coverage.programmeLimit_1;
    result.truncatedChannels = coverage.truncatedChannels_1;
    return result;
  };
  function XmltvRecords$records$lambda(it) {
    return it;
  }
  function XmltvRecords_0(format, trim, identity) {
    identity = identity === VOID ? null : identity;
    var tmp = this;
    var tmp_0 = recordFormat(format);
    var tmp_1;
    if (identity == null) {
      tmp_1 = XmltvRecords$records$lambda;
    } else {
      tmp_1 = identity;
    }
    tmp.records_1 = new XmltvRecords(tmp_0, trim, tmp_1);
  }
  protoOf(XmltvRecords_0).accept = function (rows) {
    var inductionVariable = 0;
    var last = rows.length;
    while (inductionVariable < last) {
      var row = rows[inductionVariable];
      inductionVariable = inductionVariable + 1 | 0;
      switch (row[0]) {
        case 'start':
          // Inline function 'kotlin.require' call

          // Inline function 'kotlin.require' call

          if (!(row.length >= 2 && (row.length % 2 | 0) === 0)) {
            var message = 'Failed requirement.';
            throw IllegalArgumentException_init_$Create$_0(toString_1(message));
          }

          var id = null;
          var channel = null;
          var start = null;
          var stop = null;
          var icon = null;
          var index = 2;
          while (index < row.length) {
            switch (row[index]) {
              case 'id':
                id = row[index + 1 | 0];
                break;
              case 'channel':
                channel = row[index + 1 | 0];
                break;
              case 'start':
                start = row[index + 1 | 0];
                break;
              case 'stop':
                stop = row[index + 1 | 0];
                break;
              case 'src':
                icon = row[index + 1 | 0];
                break;
            }
            index = index + 2 | 0;
          }

          this.records_1.startDecoded_6ledwt_k$(row[1], id, channel, start, stop, icon);
          break;
        case 'text':
          this.records_1.text_x72pul_k$(row[1]);
          break;
        case 'end':
          this.records_1.end_laoys1_k$(row[1]);
          break;
        case 'text-error':
          this.records_1.textError_gkacxb_k$(row[1]);
          break;
        default:
          // Inline function 'kotlin.error' call

          var message_0 = 'Unknown XMLTV event';
          throw IllegalStateException_init_$Create$_0(toString_1(message_0));
      }
    }
    // Inline function 'kotlin.collections.map' call
    var this_0 = this.records_1.drain_1l2ad4_k$();
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp$ret$6 = copyToArray(item);
      destination.add_utx5q5_k$(tmp$ret$6);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    return copyToArray(destination);
  };
  function nativeXmltvOrder(starts, format) {
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_0 = NativeRecordRules_instance.order_ew65tb_k$(toList(starts), recordFormat(format));
    return copyToArray(this_0);
  }
  function recordFormat(value) {
    var tmp;
    switch (value) {
      case 'swift':
        tmp = XmltvRecordFormat_SWIFT_getInstance();
        break;
      case 'android':
        tmp = XmltvRecordFormat_ARCHIVED_ANDROID_getInstance();
        break;
      case 'active-android':
        tmp = XmltvRecordFormat_ANDROID_getInstance();
        break;
      case 'rust':
        tmp = XmltvRecordFormat_RUST_getInstance();
        break;
      case 'rust-native':
        tmp = XmltvRecordFormat_RUST_NATIVE_getInstance();
        break;
      default:
        // Inline function 'kotlin.error' call

        var message = 'Unknown XMLTV record format';
        throw IllegalStateException_init_$Create$_0(toString_1(message));
    }
    return tmp;
  }
  function xtreamBase(value) {
    return Companion_instance_15.browserBase_s0uj0h_k$(value);
  }
  function item_0($this, entry) {
    var result = {};
    result.id = entry.id_1;
    result.name = entry.name_1;
    result.group = entry.group_1;
    result.logo = entry.logo_1;
    var tmp0_subject = entry.kind_1;
    result.kind = tmp0_subject === 'series' || tmp0_subject === 'season' ? 'folder' : tmp0_subject === 'episode' ? 'vod' : entry.kind_1;
    result.sourceId = $this.source_1.id_1;
    result.description = entry.description_1;
    result.adult = entry.adult_1;
    if (!(entry.kind_1 === 'season'))
      result.url = entry.url_1;
    if (entry.kind_1 === 'series' || entry.kind_1 === 'season') {
      result.folderType = entry.kind_1;
      result.seriesId = entry.providerId_1;
      if (entry.kind_1 === 'season')
        result.seasonNumber = entry.season_1;
    }
    if (entry.kind_1 === 'episode') {
      result.episodeNumber = entry.episode_1;
      result.seasonNumber = entry.season_1;
    } else if (!(entry.kind_1 === 'season')) {
      result.tvgId = entry.epgId_1;
      var tmp;
      if (entry.kind_1 === 'live') {
        // Inline function 'kotlin.arrayOf' call
        // Inline function 'kotlin.js.unsafeCast' call
        // Inline function 'kotlin.js.asDynamic' call
        tmp = [$this.addresses_1.epg_25ng_k$()];
      } else {
        // Inline function 'kotlin.emptyArray' call
        tmp = [];
      }
      result.epgUrls = tmp;
    }
    var tmp1_safe_receiver = entry.archiveDays_1;
    if (tmp1_safe_receiver == null)
      null;
    else {
      // Inline function 'kotlin.let' call
      result.archiveDays = tmp1_safe_receiver;
      var archive = {};
      archive.type = 'xtream';
      archive.days = tmp1_safe_receiver;
      archive.base = $this.base_1;
      archive.username = $this.source_1.username_1;
      archive.password = $this.source_1.password_1;
      archive.streamId = entry.providerId_1;
      archive.extension = $this.source_1.output_1;
      archive.correction = 0;
      result.catchup = archive;
    }
    return result;
  }
  function XtreamClient$addresses$lambda($render) {
    return function (path, query) {
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp = copyToArray(path);
      // Inline function 'kotlin.collections.map' call
      // Inline function 'kotlin.collections.mapTo' call
      var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(query, 10));
      var _iterator__ex2g4s = query.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var item = _iterator__ex2g4s.next_20eer_k$();
        // Inline function 'kotlin.arrayOf' call
        // Inline function 'kotlin.js.unsafeCast' call
        // Inline function 'kotlin.js.asDynamic' call
        var tmp$ret$3 = [item.first_1, item.second_1];
        destination.add_utx5q5_k$(tmp$ret$3);
      }
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp$ret$7 = copyToArray(destination);
      return $render(tmp, tmp$ret$7);
    };
  }
  function XtreamClient$identify$lambda($identity) {
    return function (values) {
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp$ret$0 = copyToArray(values);
      return $identity(tmp$ret$0);
    };
  }
  function XtreamClient$guide$lambda($clock) {
    return function (it) {
      return $clock(unwire(it));
    };
  }
  function XtreamClient$legacyCatalog$lambda($hash) {
    return function (it) {
      return $hash(unwire(it));
    };
  }
  function XtreamClient(input, legacy, render, resolve, component, identity) {
    var tmp = this;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp_0 = input.id;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp_1 = input.username;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp_2 = input.password;
    // Inline function 'kotlin.js.unsafeCast' call
    var tmp$ret$3 = input.output;
    tmp.source_1 = new XtreamSource(tmp_0, tmp_1, tmp_2, tmp$ret$3);
    var tmp_3 = this;
    // Inline function 'kotlin.js.unsafeCast' call
    tmp_3.base_1 = input.base;
    this.session_1 = new XtreamSession(legacy ? XtreamFormat_LEGACY_getInstance() : XtreamFormat_BROWSER_getInstance());
    var tmp_4 = this;
    tmp_4.addresses_1 = new XtreamAddresses(this.source_1, XtreamClient$addresses$lambda(render), component);
    this.resolveUrl_1 = resolve;
    this.encode_1 = component;
    var tmp_5 = this;
    tmp_5.identify_1 = XtreamClient$identify$lambda(identity);
  }
  protoOf(XtreamClient).request = function () {
    var tmp0_safe_receiver = this.session_1.get_request_jdwg4m_k$();
    var tmp;
    if (tmp0_safe_receiver == null) {
      tmp = null;
    } else {
      // Inline function 'kotlin.let' call
      tmp = this.addresses_1.api_hsene1_k$(tmp0_safe_receiver);
    }
    return tmp;
  };
  protoOf(XtreamClient).accept = function (value) {
    var tmp;
    try {
      this.session_1.accept_wd2l5t_k$(wire(value));
      tmp = null;
    } catch ($p) {
      var tmp_0;
      if ($p instanceof XtreamFailure) {
        var error = $p;
        tmp_0 = failure(error.code_1);
      } else {
        throw $p;
      }
      tmp = tmp_0;
    }
    return tmp;
  };
  protoOf(XtreamClient).catalog = function () {
    var tmp;
    try {
      var catalog = XtreamCatalogs_instance.catalog$default_3nmg05_k$(this.session_1.data_1, XtreamFormat_BROWSER_getInstance(), this.source_1, this.addresses_1, this.resolveUrl_1, this.encode_1, this.identify_1);
      var result = {};
      // Inline function 'kotlin.collections.map' call
      var this_0 = catalog.entries_1;
      // Inline function 'kotlin.collections.mapTo' call
      var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
      var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var item = _iterator__ex2g4s.next_20eer_k$();
        var tmp$ret$2 = item_0(this, item);
        destination.add_utx5q5_k$(tmp$ret$2);
      }
      // Inline function 'kotlin.collections.toTypedArray' call
      result.channels = copyToArray(destination);
      // Inline function 'kotlin.arrayOf' call
      // Inline function 'kotlin.js.unsafeCast' call
      // Inline function 'kotlin.js.asDynamic' call
      result.epgUrls = [this.addresses_1.epg_25ng_k$()];
      // Inline function 'kotlin.collections.toTypedArray' call
      var this_1 = catalog.warnings_1;
      result.warnings = copyToArray(this_1);
      tmp = result;
    } catch ($p) {
      var tmp_0;
      if ($p instanceof XtreamFailure) {
        var error = $p;
        tmp_0 = failure(error.code_1);
      } else {
        throw $p;
      }
      tmp = tmp_0;
    }
    return tmp;
  };
  protoOf(XtreamClient).shortEpgUrl = function (id) {
    return this.addresses_1.legacyShortEpg_7mvhu7_k$(id);
  };
  protoOf(XtreamClient).fallbackPlaylist = function (networkFailure) {
    return this.addresses_1.legacyPlaylist_76ezs6_k$(this.base_1, networkFailure);
  };
  protoOf(XtreamClient).guide = function (data, clock) {
    var tmp = LegacyXtream_instance;
    var tmp_0 = wire(data);
    return legacyGuide(tmp.guide_5n5fuv_k$(tmp_0, XtreamClient$guide$lambda(clock)));
  };
  protoOf(XtreamClient).legacyCatalog = function (hash) {
    var tmp = LegacyXtream_instance;
    var catalog = tmp.catalog_i7n7y4_k$(this.session_1.data_1, this.addresses_1, XtreamClient$legacyCatalog$lambda(hash));
    var result = {};
    // Inline function 'kotlin.collections.map' call
    var this_0 = catalog.entries_1;
    // Inline function 'kotlin.collections.mapTo' call
    var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
    var _iterator__ex2g4s = this_0.iterator_jk1svi_k$();
    while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
      var item = _iterator__ex2g4s.next_20eer_k$();
      var tmp$ret$2 = item.id_1;
      destination.add_utx5q5_k$(tmp$ret$2);
    }
    // Inline function 'kotlin.collections.toTypedArray' call
    result.ids = copyToArray(destination);
    result.channels = Object.create(null);
    result.groups = Object.create(null);
    // Inline function 'kotlin.collections.toTypedArray' call
    var this_1 = catalog.groupOrder_1;
    result.groupOrder = copyToArray(this_1);
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_0 = catalog.groups_1.get_entries_p20ztl_k$().iterator_jk1svi_k$();
    while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
      var element = _iterator__ex2g4s_0.next_20eer_k$();
      // Inline function 'kotlin.collections.component1' call
      var key = element.get_key_18j28a_k$();
      // Inline function 'kotlin.collections.component2' call
      var ids = element.get_value_j01efc_k$();
      // Inline function 'kotlin.collections.toTypedArray' call
      var tmp$ret$10 = copyToArray(ids);
      result.groups[key] = tmp$ret$10;
    }
    // Inline function 'kotlin.collections.forEach' call
    var _iterator__ex2g4s_1 = catalog.entries_1.iterator_jk1svi_k$();
    while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
      var element_0 = _iterator__ex2g4s_1.next_20eer_k$();
      result.channels[element_0.id_1] = legacyChannel(element_0.name_1, element_0.providerId_1, element_0.category_1, element_0.group_1, element_0.logo_1, element_0.url_1);
    }
    return result;
  };
  protoOf(XtreamClient).seriesRequest = function (parentValue) {
    var tmp;
    try {
      var parent = wire(parentValue);
      var result = {};
      result.url = this.addresses_1.api_hsene1_k$(XtreamCatalogs_instance.seriesRequest_ssrwjj_k$(parent.get_6bo4tg_k$('seriesId'), parent.get_6bo4tg_k$('folderType').string_er2cq7_k$(), XtreamFormat_BROWSER_getInstance()));
      tmp = result;
    } catch ($p) {
      var tmp_0;
      if ($p instanceof XtreamFailure) {
        var error = $p;
        tmp_0 = failure(error.code_1);
      } else {
        throw $p;
      }
      tmp = tmp_0;
    }
    return tmp;
  };
  protoOf(XtreamClient).series = function (data, parentValue) {
    var tmp;
    try {
      var node = wire(parentValue);
      var parent = new XtreamSeriesParent(node.get_6bo4tg_k$('seriesId').string_er2cq7_k$(), node.get_6bo4tg_k$('name').truthy_eb26j6_k$() ? node.get_6bo4tg_k$('name').string_er2cq7_k$() : '', node.get_6bo4tg_k$('logo').truthy_eb26j6_k$() ? node.get_6bo4tg_k$('logo').string_er2cq7_k$() : '', node.get_6bo4tg_k$('description').truthy_eb26j6_k$() ? node.get_6bo4tg_k$('description').string_er2cq7_k$() : '', node.get_6bo4tg_k$('adult').truthy_eb26j6_k$());
      var series = XtreamCatalogs_instance.episodes_3fcv0q_k$(wire(data), XtreamFormat_BROWSER_getInstance(), this.source_1, this.addresses_1, parent, this.resolveUrl_1, this.encode_1, this.identify_1);
      var result = {};
      result.episodes = Object.create(null);
      // Inline function 'kotlin.collections.groupBy' call
      var tmp0 = series.entries_1;
      // Inline function 'kotlin.collections.groupByTo' call
      var destination = LinkedHashMap_init_$Create$();
      var _iterator__ex2g4s = tmp0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s.hasNext_bitz1p_k$()) {
        var element = _iterator__ex2g4s.next_20eer_k$();
        var key = element.season_1;
        // Inline function 'kotlin.collections.getOrPut' call
        var value = destination.get_wei43m_k$(key);
        var tmp_0;
        if (value == null) {
          var answer = ArrayList_init_$Create$();
          destination.put_4fpzoq_k$(key, answer);
          tmp_0 = answer;
        } else {
          tmp_0 = value;
        }
        var list = tmp_0;
        list.add_utx5q5_k$(element);
      }
      // Inline function 'kotlin.collections.forEach' call
      // Inline function 'kotlin.collections.iterator' call
      var _iterator__ex2g4s_0 = destination.get_entries_p20ztl_k$().iterator_jk1svi_k$();
      while (_iterator__ex2g4s_0.hasNext_bitz1p_k$()) {
        var element_0 = _iterator__ex2g4s_0.next_20eer_k$();
        // Inline function 'kotlin.collections.component1' call
        var key_0 = element_0.get_key_18j28a_k$();
        // Inline function 'kotlin.collections.component2' call
        var rows = element_0.get_value_j01efc_k$();
        // Inline function 'kotlin.collections.map' call
        // Inline function 'kotlin.collections.mapTo' call
        var destination_0 = ArrayList_init_$Create$_0(collectionSizeOrDefault(rows, 10));
        var _iterator__ex2g4s_1 = rows.iterator_jk1svi_k$();
        while (_iterator__ex2g4s_1.hasNext_bitz1p_k$()) {
          var item = _iterator__ex2g4s_1.next_20eer_k$();
          var tmp$ret$12 = item_0(this, item);
          destination_0.add_utx5q5_k$(tmp$ret$12);
        }
        // Inline function 'kotlin.collections.toTypedArray' call
        var tmp$ret$13 = copyToArray(destination_0);
        result.episodes['$' + key_0] = tmp$ret$13;
      }
      // Inline function 'kotlin.collections.map' call
      var this_0 = XtreamCatalogs_instance.seasons_t15u6m_k$(series, this.source_1, parent, this.encode_1);
      // Inline function 'kotlin.collections.mapTo' call
      var destination_1 = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_0, 10));
      var _iterator__ex2g4s_2 = this_0.iterator_jk1svi_k$();
      while (_iterator__ex2g4s_2.hasNext_bitz1p_k$()) {
        var item_1 = _iterator__ex2g4s_2.next_20eer_k$();
        var tmp$ret$16 = item_0(this, item_1);
        destination_1.add_utx5q5_k$(tmp$ret$16);
      }
      // Inline function 'kotlin.collections.toTypedArray' call
      result.folders = copyToArray(destination_1);
      // Inline function 'kotlin.collections.toTypedArray' call
      var this_1 = series.warnings_1;
      result.warnings = copyToArray(this_1);
      tmp = result;
    } catch ($p) {
      var tmp_1;
      if ($p instanceof XtreamFailure) {
        var error = $p;
        tmp_1 = failure(error.code_1);
      } else {
        throw $p;
      }
      tmp = tmp_1;
    }
    return tmp;
  };
  function legacyXtreamClient(base, username, password, encode) {
    var source = {};
    source.id = 'xtream';
    source.base = base;
    source.username = username;
    source.password = password;
    source.output = 'm3u8';
    var tmp = legacyXtreamClient$lambda(base, encode);
    var tmp_0 = legacyXtreamClient$lambda_0;
    return new XtreamClient(source, true, tmp, tmp_0, encode, legacyXtreamClient$lambda_1);
  }
  function legacyXtreamClient$lambda$lambda($encode) {
    return function (it) {
      return $encode(it);
    };
  }
  function legacyXtreamClient$lambda$lambda_0($encode) {
    return function (it) {
      return $encode(it[0]) + '=' + $encode(it[1]);
    };
  }
  function legacyXtreamClient$lambda($base, $encode) {
    return function (path, query) {
      var tmp = $base + '/';
      var tmp_0 = tmp + joinToString(path, '/', VOID, VOID, VOID, VOID, legacyXtreamClient$lambda$lambda($encode));
      var tmp_1;
      // Inline function 'kotlin.collections.isEmpty' call
      if (query.length === 0) {
        tmp_1 = '';
      } else {
        tmp_1 = joinToString(query, '&', '?', VOID, VOID, VOID, legacyXtreamClient$lambda$lambda_0($encode));
      }
      return tmp_0 + tmp_1;
    };
  }
  function legacyXtreamClient$lambda_0(it) {
    return it;
  }
  function legacyXtreamClient$lambda_1(it) {
    return '';
  }
  //region block: post-declaration
  protoOf(InternalHashMap).containsAllEntries_m9iqdx_k$ = containsAllEntries;
  //endregion
  //region block: init
  Companion_instance_0 = new Companion_0();
  Unit_instance = new Unit();
  _stableSortingIsSupported = null;
  Companion_instance_3 = new Companion_3();
  Companion_instance_4 = new Companion_4();
  Companion_instance_5 = new Companion_5();
  Companion_instance_6 = new Companion_6();
  EmptyIterator_instance = new EmptyIterator();
  Companion_instance_9 = new Companion_9();
  Companion_instance_10 = new Companion_10();
  State_instance = new State();
  UNINITIALIZED_VALUE_instance = new UNINITIALIZED_VALUE();
  Companion_instance_11 = new Companion_11();
  GuideResponseCache_instance = new GuideResponseCache();
  LegacyGuideSchedule_instance = new LegacyGuideSchedule();
  GuideProgrammeRules_instance = new GuideProgrammeRules();
  Companion_instance_12 = new Companion_12();
  GuideNames_instance = new GuideNames();
  GuideSchedule_instance = new GuideSchedule();
  LegacyXtream_instance = new LegacyXtream();
  NativeGuideNames_instance = new NativeGuideNames();
  NativeGuideSources_instance = new NativeGuideSources();
  NativeSourceLoad_instance = new NativeSourceLoad();
  OperatorPlaylist_instance = new OperatorPlaylist();
  ProviderPlaylist_instance = new ProviderPlaylist();
  CoreNumber_instance = new CoreNumber();
  StalkerCatalogs_instance = new StalkerCatalogs();
  StalkerProtocol_instance = new StalkerProtocol();
  Companion_instance_14 = new Companion_14();
  NativeRecordRules_instance = new NativeRecordRules();
  XtreamCatalogs_instance = new XtreamCatalogs();
  Companion_instance_15 = new Companion_15();
  //endregion
  //region block: exports
  function $jsExportAll$(_) {
    _.parseXmltvTimestamp = parseXmltvTimestamp;
    _.parseBrowserXmltvTime = parseBrowserXmltvTime;
    _.normalizedChannelName = normalizedChannelName;
    _.canonicalChannelName = canonicalChannelName;
    _.chooseGuideChannel = chooseGuideChannel;
    _.ScheduleSelection = ScheduleSelection;
    _.selectGuideSchedule = selectGuideSchedule;
    _.nativeGuideTime = nativeGuideTime;
    _.nativeGuideName = nativeGuideName;
    _.nativeGuideStripShift = nativeGuideStripShift;
    _.nativeGuideShift = nativeGuideShift;
    _.NativeMatch = NativeMatch;
    _.NativeGuide = NativeGuide;
    _.nativeGuideSlice = nativeGuideSlice;
    _.archiveUrl = archiveUrl;
    _.providerArchiveUrl = providerArchiveUrl;
    _.parseBrowserPlaylist = parseBrowserPlaylist;
    _.legacyPlaylistAttribute = legacyPlaylistAttribute;
    _.parseProviderPlaylist = parseProviderPlaylist;
    _.parsePlaylistMedia = parsePlaylistMedia;
    _.parseOperatorPlaylist = parseOperatorPlaylist;
    _.parseBrowserGuide = parseBrowserGuide;
    _.mergeBrowserGuides = mergeBrowserGuides;
    _.matchedGuideChannel = matchedGuideChannel;
    _.shiftBrowserGuide = shiftBrowserGuide;
    _.BrowserGuideLookup = BrowserGuideLookup;
    _.legacyGuideSelection = legacyGuideSelection;
    _.legacyGuideShift = legacyGuideShift;
    _.legacyGuideCacheCapacity = legacyGuideCacheCapacity;
    _.legacyGuideCacheRead = legacyGuideCacheRead;
    _.legacyGuideCacheOrder = legacyGuideCacheOrder;
    _.nativeGuideSources = nativeGuideSources;
    _.nativeGuideUnowned = nativeGuideUnowned;
    _.nativeGuideLookup = nativeGuideLookup;
    _.nativeGuideDisk = nativeGuideDisk;
    _.nativeGuideFresh = nativeGuideFresh;
    _.nativeGuideRefresh = nativeGuideRefresh;
    _.nativeGuideEvictSourceSet = nativeGuideEvictSourceSet;
    _.nativeGuideLoadStart = nativeGuideLoadStart;
    _.nativeGuideLoadNext = nativeGuideLoadNext;
    _.NativeGuideSourceBatch = NativeGuideSourceBatch;
    _.stalkerTextDenied = stalkerTextDenied;
    _.stalkerConfig = stalkerConfig;
    _.StalkerClient = StalkerClient;
    _.LegacyStalkerClient = LegacyStalkerClient;
    _.streamingGuideIdentities = streamingGuideIdentities;
    _.StreamingGuideFilter = StreamingGuideFilter;
    _.XmltvRecords = XmltvRecords_0;
    _.nativeXmltvOrder = nativeXmltvOrder;
    _.xtreamBase = xtreamBase;
    _.XtreamClient = XtreamClient;
    _.legacyXtreamClient = legacyXtreamClient;
  }
  $jsExportAll$(_);
  //endregion
  return _;
}));



;(function (root) { if (typeof module !== "object" || !module.exports) root.OttPlayCore = root["play.ott:ottplay-shared-core"]; }(typeof self !== "undefined" ? self : this));

/**
 * Configuration and global state for OTT-play FOSS
 */

// Version
export const PLAYER_VERSION = "__OTTP_VERSION__";

// Host URL
export let hostUrl = "";

// Device type
export let deviceType = "";

// EPG domain
export let epgDomain = "";

// Parental PIN
export let parentPIN = "1234";

// Hide menus list
export let hideMenus: string[] = [];

// Sleep timer
export let sleepTimer: any = null;

// Info timeout
export let infoTimeout: any = null;

// Number input state
export let numberBuffer = "";
export let numberTimeout: any = null;

// List state
export let isListVisible = false;
export let listSelectionIndex = 0;
export let listDataArray: any[] = [];
export let getListItemFn: ((item: any, idx: number) => string) | null = null;
export let detailListActionFn: (() => void) | null = null;
export let listKeyHandlerFn: ((key: any) => boolean) | null = null;
export let selIndex = 0;
export let listArray: any[] = [];

// Edit mode
export let isEditMode = false;
export let editCaption = "";
export let editValue = "";

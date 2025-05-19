#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { DAVClient } = require("tsdav");

// Environment variables for DAV provider and credentials
const DAV_PROVIDER = (process.env.DAV_PROVIDER).toLowerCase(); // e.g. "fastmail" or "icloud"
const DAV_USERNAME = process.env.DAV_USERNAME || "";
const DAV_PASSWORD = process.env.DAV_PASSWORD || ""; // App-specific password

if (!DAV_USERNAME || !DAV_PASSWORD) {
  console.error("Error: DAV_USERNAME and DAV_PASSWORD environment variables are required.");
  process.exit(1);
}

let calDavServerUrl, cardDavServerUrl, webDavServerUrl;
let davClient, cardDavClient, webDavClient;

const server = new McpServer({
  name: `DAV MCP (${DAV_PROVIDER})`,
  version: "0.1.0"
});

if (DAV_PROVIDER === "fastmail") {
  calDavServerUrl = `https://caldav.fastmail.com/dav/principals/user/${DAV_USERNAME}/`;
  cardDavServerUrl = `https://carddav.fastmail.com/dav/principals/user/${DAV_USERNAME}/`;
  webDavServerUrl = `https://webdav.fastmail.com/dav/principals/user/${DAV_USERNAME}/`; // Or simply https://webdav.fastmail.com/

  davClient = new DAVClient({
    serverUrl: calDavServerUrl,
    credentials: { username: DAV_USERNAME, password: DAV_PASSWORD },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  cardDavClient = new DAVClient({
    serverUrl: cardDavServerUrl,
    credentials: { username: DAV_USERNAME, password: DAV_PASSWORD },
    authMethod: "Basic",
    defaultAccountType: "carddav",
  });

  webDavClient = new DAVClient({
    serverUrl: webDavServerUrl,
    credentials: { username: DAV_USERNAME, password: DAV_PASSWORD },
    authMethod: "Basic",
    defaultAccountType: "webdav",
  });

} else if (DAV_PROVIDER === "icloud") {
  // For iCloud, the serverUrl is often the base domain, and tsdav handles discovery.
  // The username is the Apple ID.
  calDavServerUrl = "https://caldav.icloud.com"; // tsdav examples use the base URL
  cardDavServerUrl = "https://contacts.icloud.com"; // tsdav examples use the base URL
  // WebDAV for iCloud Drive is more complex and not directly shown with simple tsdav setup.
  // So, WebDAV tools will be limited/unavailable for iCloud in this basic setup.
  webDavServerUrl = null; // Explicitly null for iCloud in this config

  davClient = new DAVClient({
    serverUrl: calDavServerUrl,
    credentials: { username: DAV_USERNAME, password: DAV_PASSWORD }, // Apple ID and app-specific password
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  cardDavClient = new DAVClient({
    serverUrl: cardDavServerUrl,
    credentials: { username: DAV_USERNAME, password: DAV_PASSWORD }, // Apple ID and app-specific password
    authMethod: "Basic",
    defaultAccountType: "carddav",
  });
  
  // webDavClient is not initialized for iCloud here

} else {
  console.error(`Error: Unsupported DAV_PROVIDER "${DAV_PROVIDER}". Use "fastmail" or "icloud".`);
  process.exit(1);
}

server.tool(
  "get_my_calendars",
  {},
  async () => {
    if (!davClient) return { content: [{ type: "text", text: "CalDAV client not initialized for this provider."}], isError: true };
    try {
      await davClient.login();
      const calendars = await davClient.fetchCalendars();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(calendars, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error in get_my_calendars:", error);
      return {
        content: [{
          type: "text",
          text: `Error listing calendars: ${JSON.stringify(error.message || error)}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "get_calendar_events",
  {
    calendarUrl: z.string().describe("The unique identifier (URL) of the calendar from which to fetch events. You can get this from 'get_my_calendars'."),
    timeRangeStart: z.string().datetime().optional().describe("ISO 8601 datetime for start of range"),
    timeRangeEnd: z.string().datetime().optional().describe("ISO 8601 datetime for end of range"),
  },
  async ({ calendarUrl, timeRangeStart, timeRangeEnd }) => {
    if (!davClient) return { content: [{ type: "text", text: "CalDAV client not initialized for this provider."}], isError: true };
    try {
      await davClient.login();
      const calendars = await davClient.fetchCalendars(); // Needed to find the calendar object
      const calendar = calendars.find(cal => cal.url === calendarUrl);

      if (!calendar) {
        return {
          content: [{ type: "text", text: `Error: Calendar with URL ${calendarUrl} not found.` }],
          isError: true
        };
      }
      
      const fetchOptions = { calendar };
      if (timeRangeStart && timeRangeEnd) {
        fetchOptions.timeRange = { start: timeRangeStart, end: timeRangeEnd };
      }

      const calendarObjects = await davClient.fetchCalendarObjects(fetchOptions);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(calendarObjects, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error in get_calendar_events:", error);
      return {
        content: [{
          type: "text",
          text: `Error fetching calendar objects: ${JSON.stringify(error.message || error)}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "get_my_contact_lists",
  {},
  async () => {
    if (!cardDavClient) return { content: [{ type: "text", text: "CardDAV client not initialized for this provider."}], isError: true };
    try {
      await cardDavClient.login();
      const addressBooks = await cardDavClient.fetchAddressBooks();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(addressBooks, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error in get_my_contact_lists:", error);
      return {
        content: [{
          type: "text",
          text: `Error listing address books: ${JSON.stringify(error.message || error)}`
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "get_contacts_from_list",
  {
    addressBookUrl: z.string().describe("The unique identifier (URL) of the contact list from which to fetch contacts. You can get this from 'get_my_contact_lists'."),
  },
  async ({ addressBookUrl }) => {
    if (!cardDavClient) return { content: [{ type: "text", text: "CardDAV client not initialized for this provider."}], isError: true };
    try {
      await cardDavClient.login();
      const addressBooks = await cardDavClient.fetchAddressBooks(); // Needed to find the address book object
      const addressBook = addressBooks.find(ab => ab.url === addressBookUrl);

      if (!addressBook) {
        return {
          content: [{ type: "text", text: `Error: Address book with URL ${addressBookUrl} not found.` }],
          isError: true
        };
      }

      const vcards = await cardDavClient.fetchVCards({ addressBook });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(vcards, null, 2)
        }]
      };
    } catch (error) {
      console.error("Error in get_contacts_from_list:", error);
      return {
        content: [{
          type: "text",
          text: `Error fetching vCards: ${JSON.stringify(error.message || error)}`
        }],
        isError: true
      };
    }
  }
);

if (webDavClient) {
  server.tool(
    "list_my_files_and_folders",
    {
      path: z.string().optional().describe("The specific folder path to list. For example, 'Documents/Work'. If empty, lists files and folders in the main (root) directory."),
    },
    async ({ path }) => {
      try {
        await webDavClient.login();
        let collectionUrl = webDavClient.serverUrl; // Base server URL from client
        if (path && path !== '/') {
          // Ensure no double slashes and correct joining
          const base = collectionUrl.endsWith('/') ? collectionUrl.slice(0, -1) : collectionUrl;
          const relativePath = path.startsWith('/') ? path.substring(1) : path;
          collectionUrl = `${base}/${relativePath}`;
        }
        
        const objects = await webDavClient.fetchObjects({ collection: collectionUrl });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(objects, null, 2)
          }]
        };
      } catch (error) {
        console.error("Error in list_my_files_and_folders:", error);
        return {
          content: [{
            type: "text",
            text: `Error listing WebDAV collection: ${JSON.stringify(error.message || error)}`
          }],
          isError: true
        };
      }
    }
  );

  server.tool(
    "get_file_or_folder_details",
    {
      fileUrl: z.string().describe("The unique identifier (URL) of the file or folder to get details for. You can get this from 'list_my_files_and_folders'."),
    },
    async ({ fileUrl }) => {
      try {
        await webDavClient.login();
        // fetchObjects can be used with a full URL to an object to get its properties
        const objectProperties = await webDavClient.fetchObjects({ collection: fileUrl });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(objectProperties, null, 2)
          }]
        };
      } catch (error) {
        console.error("Error in get_file_or_folder_details:", error);
        return {
          content: [{
            type: "text",
            text: `Error getting WebDAV file metadata: ${JSON.stringify(error.message || error)}`
          }],
          isError: true
        };
      }
    }
  );
}

const transport = new StdioServerTransport();
server.connect(transport); 
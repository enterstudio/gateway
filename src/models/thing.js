/**
 * Thing Model.
 *
 * Represents a Web Thing.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const Constants = require('../constants');
const Database = require('../db.js');
const EventEmitter = require('events');
const UserProfile = require('../user-profile');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const tmp = require('tmp');

/**
 * Thing constructor.
 *
 * Create a Thing object from an id and a valid Thing description.
 *
 * @param {String} id Unique ID.
 * @param {Object} description Thing description.
 */
const Thing = function(id, description) {
  if (!id || !description) {
    console.error('id and description needed to create new Thing');
    return;
  }
  // Parse the Thing Description
  this.id = id;
  this.name = description.name || '';
  this.type = description.type || '';
  this['@context'] =
    description['@context'] || 'https://iot.mozilla.org/schemas';
  this['@type'] = description['@type'] || [];
  this.description = description.description || '';
  this.href = `${Constants.THINGS_PATH}/${this.id}`;
  this.properties = {};
  this.actions = description.actions || {};
  this.events = description.events || {};
  this.eventsDispatched = [];
  this.emitter = new EventEmitter();
  if (description.properties) {
    for (const propertyName in description.properties) {
      const property = description.properties[propertyName];
      // Give the property a URL if it doesn't have one
      property.href = `${Constants.THINGS_PATH}/${this.id
      }${Constants.PROPERTIES_PATH}/${propertyName}`;
      this.properties[propertyName] = property;
    }
  }
  this.floorplanX = description.floorplanX;
  this.floorplanY = description.floorplanY;
  this.selectedCapability = description.selectedCapability;
  this.websockets = [];
  this.links = [
    {
      rel: 'properties',
      href: `${this.href}/properties`,
    },
    {
      rel: 'actions',
      href: `${this.href}/actions`,
    },
    {
      rel: 'events',
      href: `${this.href}/events`,
    },
  ];

  const uiLink = {
    rel: 'alternate',
    mediaType: 'text/html',
    href: this.href,
  };

  if (description.hasOwnProperty('uiHref') && description.uiHref) {
    uiLink.href = description.uiHref;
  } else if (description.hasOwnProperty('links')) {
    for (const link of description.links) {
      if (link.rel === 'alternate' &&
          link.mediaType === 'text/html' &&
          link.href.startsWith('http')) {
        uiLink.href = link.href;
        break;
      }
    }
  }

  this.links.push(uiLink);

  for (const actionName in this.actions) {
    this.actions[actionName].href =
      `${this.href}/actions/${actionName}`;
  }

  for (const eventName in this.events) {
    this.events[eventName].href = `${this.href}/events/${eventName}`;
  }

  this.iconHref = null;
  if (description.iconHref) {
    this.iconHref = description.iconHref;
  } else if (description.iconData) {
    this.setIcon(description.iconData, false);
  }
};

/**
 * Set the x and y co-ordinates for a Thing on the floorplan.
 *
 * @param {number} x The x co-ordinate on floorplan (0-100).
 * @param {number} y The y co-ordinate on floorplan (0-100).
 * @return {Promise} A promise which resolves with the description set.
 */
Thing.prototype.setCoordinates = function(x, y) {
  this.floorplanX = x;
  this.floorplanY = y;
  return Database.updateThing(this.id, this.getDescription());
};

/**
 * Set the name of this Thing.
 *
 * @param {String} name The new name
 * @return {Promise} A promise which resolves with the description set.
 */
Thing.prototype.setName = function(name) {
  this.name = name;
  return Database.updateThing(this.id, this.getDescription());
};

/**
 * Set the custom icon for this Thing.
 *
 * @param {Object} iconData Base64-encoded icon and its mime-type.
 * @param {Boolean} updateDatabase Whether or not to update the database after
 *                                 setting.
 */
Thing.prototype.setIcon = function(iconData, updateDatabase) {
  if (!iconData.data ||
      !['image/jpeg', 'image/png', 'image/svg+xml'].includes(iconData.mime)) {
    console.error('Invalid icon data:', iconData);
    return;
  }

  if (this.iconHref) {
    try {
      fs.unlinkSync(path.join(UserProfile.baseDir, this.iconHref));
    } catch (e) {
      console.error('Failed to remove old icon:', e);
      // continue
    }

    this.iconHref = null;
  }

  let extension;
  switch (iconData.mime) {
    case 'image/jpeg':
      extension = '.jpg';
      break;
    case 'image/png':
      extension = '.png';
      break;
    case 'image/svg+xml':
      extension = '.svg';
      break;
  }

  let tempfile;
  try {
    tempfile = tmp.fileSync({
      mode: parseInt('0644', 8),
      template: path.join(UserProfile.uploadsDir, `XXXXXX${extension}`),
      detachDescriptor: true,
      keep: true,
    });

    const data = Buffer.from(iconData.data, 'base64');
    fs.writeFileSync(tempfile.fd, data);
  } catch (e) {
    console.error('Failed to write icon:', e);
    if (tempfile) {
      try {
        fs.unlinkSync(tempfile.fd);
      } catch (e) {
        // pass
      }
    }

    return;
  }

  this.iconHref = path.join('/uploads', path.basename(tempfile.name));

  if (updateDatabase) {
    return Database.updateThing(this.id, this.getDescription());
  }
};

/**
 * Set the selected capability of this Thing.
 *
 * @param {String} capability The selected capability
 * @return {Promise} A promise which resolves with the description set.
 */
Thing.prototype.setSelectedCapability = function(capability) {
  this.selectedCapability = capability;
  return Database.updateThing(this.id, this.getDescription());
};

/**
 * Dispatch an event to all listeners subscribed to the Thing
 * @param {Event} event
 */
Thing.prototype.dispatchEvent = function(event) {
  if (!event.thingId) {
    event.thingId = this.id;
  }
  this.eventsDispatched.push(event);
  this.emitter.emit(Constants.EVENT, event);
};

/**
 * Add a subscription to the Thing's events
 * @param {Function} callback
 */
Thing.prototype.addEventSubscription = function(callback) {
  this.emitter.on(Constants.EVENT, callback);
};

/**
 * Remove a subscription to the Thing's events
 * @param {Function} callback
 */
Thing.prototype.removeEventSubscription = function(callback) {
  this.emitter.removeListener(Constants.EVENT, callback);
};

/**
 * Get a JSON Thing Description for this Thing.
 *
 * @param {String} reqHost request host, if coming via HTTP
 * @param {Boolean} reqSecure whether or not the request is secure, i.e. TLS
 */
Thing.prototype.getDescription = function(reqHost, reqSecure) {
  const links = JSON.parse(JSON.stringify(this.links));

  if (typeof reqHost !== 'undefined') {
    const wsLink = {
      rel: 'alternate',
      href: `${reqSecure ? 'wss' : 'ws'}://${reqHost}${this.href}`,
    };

    links.push(wsLink);
  }

  return {
    name: this.name,
    type: this.type,
    '@context': this['@context'],
    '@type': this['@type'],
    description: this.description,
    href: this.href,
    properties: this.properties,
    actions: this.actions,
    events: this.events,
    links: links,
    floorplanX: this.floorplanX,
    floorplanY: this.floorplanY,
    selectedCapability: this.selectedCapability,
    iconHref: this.iconHref,
  };
};

Thing.prototype.registerWebsocket = function(ws) {
  this.websockets.push(ws);
};

/**
 * Remove and clean up the Thing
 */
Thing.prototype.remove = function() {
  if (this.iconHref) {
    try {
      fs.unlinkSync(path.join(UserProfile.baseDir, this.iconHref));
    } catch (e) {
      console.error('Failed to remove old icon:', e);
      // continue
    }

    this.iconHref = null;
  }

  this.websockets.forEach(function(ws) {
    if (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  });
};

/**
 * Add an action
 * @param {Action} action
 * @return {boolean} Whether a known action
 */
Thing.prototype.addAction = function(action) {
  return this.actions.hasOwnProperty(action.name);
};

/**
 * Remove an action
 * @param {Action} action
 * @return {boolean} Whether a known action
 */
Thing.prototype.removeAction = function(action) {
  return this.actions.hasOwnProperty(action.name);
};

module.exports = Thing;

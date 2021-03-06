/**
 * ColorTemperatureDetail
 *
 * A bubble showing the color temperature of a thing
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

'use strict';

const Utils = require('../utils');

class ColorTemperatureDetail {
  constructor(thing, name, property) {
    this.thing = thing;
    this.name = name;
    this.label = property.label || 'Color Temperature';
    this.min = property.hasOwnProperty('min') ? property.min : property.minimum;
    this.max = property.hasOwnProperty('max') ? property.max : property.maximum;
    this.id = `color-temperature-${Utils.escapeHtmlForIdClass(this.name)}`;
  }

  attach() {
    this.temperature = this.thing.element.querySelector(`#${this.id}`);
    this.temperature.addEventListener('change', this.set.bind(this));
  }

  view() {
    return `
      <webthing-color-temperature-property min="${this.min}" max="${this.max}"
        data-name="${Utils.escapeHtml(this.label)}" id="${this.id}">
      </webthing-color-temperature-property>`;
  }

  update(temperature) {
    if (!this.temperature) {
      return;
    }

    if (temperature == this.temperature.value) {
      return;
    }

    this.temperature.value = temperature;
  }

  set() {
    this.thing.setProperty(this.name, this.temperature.value);
  }
}

module.exports = ColorTemperatureDetail;

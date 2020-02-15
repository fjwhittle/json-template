/**
 * @module JSONTemplate
 * @author Francis Whittle <code@powered.ninja>
 *
 * Copyright (C) 2020 Francis Whittle
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * Provides a simple logic-free templating system for HTML based on Javascript
 * objects.
 */

/**
 * Exported Template Module
 */
class JSONTemplate {
  /**
   * Use a known template to fill a target Element from object data.
   *
   * @param {Element|string} target - Element to add filled template content to. Can be a CSS selector
   * @param {HTMLTemplateElement|string} template - <template> element to fill. Can be a CSS selector
   * @param {Iterator|AsyncIterator|Object} data - contains values to replace in the template.
   * @returns {Promise[Array]} - Promised resolved with an array of added nodes.
   */
  static fill(target, template, data) {
    return new Promise(async function(resolve, reject) {
      /* If target and/or template are specified as a string, use it as a CSS selector to find an element */
      if(typeof target == 'string') {
	target = document.querySelector(target);
      }
      if(typeof template == 'string') {
	template = document.querySelector(template);
      }

      /* Make sure we're dealing with appropriate elements. */
      if(!(target instanceof Element))
	reject('Target is not an element.');
      if(!(template instanceof HTMLTemplateElement))
	reject('Template is not a <template> element.');

      /* Put data in an array if it's not already iterable. */
      if ((typeof data[Symbol.asyncIterator] !== 'function') &&
	  (typeof data[Symbol.iterator] !== 'function')){
        data = [ data ];
      }

      let nodes = [];

      /* data could be asynchronous, so loop through it as such. */
      for await (let value of data) {
	/* Copy of the template's DocumentFragment. */
        let item = template.content.cloneNode(true);

	/* Start the filling process on the fragment copy. */
        JSONTemplate.fillKey(item, value);

	nodes.push(...item.childNodes);

	/* Add the filled template to the target */
        target.appendChild(item);
      }

      resolve(nodes);
    });
  }

  /**
   * Recursion entry point to fill a particular node using a data object.
   *
   * Meant to be used internally, but could also work for single node replacement, however note that
   * the target element is altered directly unless the data object is iterable.
   * Collapses <template>s
   *
   * @param {Element} target - element to fill with data
   * @param {Object|Iterable} data - Iterable data will cause multiple copies of the target element
   *                                to be cloned.
   */
  static fillKey(target, data) {
    /* Create Array out of target's child elements, this will be extended to recurse into
     * non-matching grandchildren. */
    let children = [...target.children];

    for(let ch of children) {
      /* First fill in the attributes of the child node. */
      this.fillAttrs(ch, data);

      /* If we're recursing into a slot element we can use its name property, otherwise get the key
       * from the element's data. */
      let key = (ch.tagName.toLowerCase() == 'slot' && ch.name)? ch.name : ch.dataset.key;

      /* Only operate on elements that specify a data key. */
      if (key) {
	/* Remove the element if the required key is not present. */
	if (!(key in data)) {
	  ch.parentNode.removeChild(ch);
	}
	/* Replace the element directly if the keyed data is not an object. */
	else if (!(data[key] instanceof Object)) {
          let el =
	      ('content' in ch) && (ch.content instanceof DocumentFragment)
	      ? ch.content
	      : ch;

          ch.innerHTML = data[key];

	  ch.parentNode.replaceChild(el, ch);
        }
	/* Loop through arrays in the data, recursively filling children. */
	else if (data[key] instanceof Array) {
	  /* Fragment to hold all the cloned children. */
          let frag = new DocumentFragment();

          for (let entry of data[key]) {
	    // Clone the node, or its contained Document Fragment (collapse templates)
            let el =
		('content' in ch) && (ch.content instanceof DocumentFragment)
		? ch.content.cloneNode(true)
		: ch.cloneNode(true);
            if (typeof entry == 'string' || typeof entry == 'number') {
              this.fillAttrs(el, data);
              el.innerHTML = entry;
            } else {
              this.fillKey(el, entry);
            }

	    /* Add this copy to the containing fragment. */
            frag.appendChild(el);
          }

	  /* Replace the child with fragment. */
          try {
            ch.parentNode.replaceChild(frag, ch);
          } catch (e) {
            console.error(e.message, ch, ch.parentNode, frag);
          }
        }
	/* Finally, recurse into objects. */
	else {
	  // Clone the node, or its contained Document Fragment (collapse templates)
          let el =
	      ('content' in ch) && (ch.content instanceof DocumentFragment)
	      ? ch.content
	      : ch;

          this.fillKey(el, data[key]);

	  ch.parentNode.replaceChild(el, ch);
        }
      }
      /* Add child elements onto the end of the queue when there was no key */
      else {
	children.push(...ch.children);
      }
    }
    return target;
  }

  static fillAttrs (target, data) {
    for(let pi of [...target.childNodes]
            .filter((n) => (n instanceof ProcessingInstruction) && (n.target == 'attr'))
       ) {

      try {
	let name, key;

        try { [, name] = pi.data.match(/\bname="([^"]+)"/) }
	catch (e) { throw 'No attribute name specified' }

	try { [, key]  = pi.data.match(/\bkey="([^"]+)"/) }
	catch (e) { throw `No attribute key specified for ‘${name}’` }

        if (key in data) {
          target.setAttribute(name, data[key]);
        }
      } catch (e) {
	console.warn('Attributes could not be assigned from ', target, pi, ':', e);
      }
    }
    if('attributes' in target) [...target.attributes].map((attr) => {
      if(attr.value.match(/\$\{([^}]+)\}/)) {
        attr.value = attr.value.replace(
	  /\$\{([^}]+)\}/g,
	  (all, key) => key
	    .split('.')
	    .reduce(
	      (acc, cur) => ((typeof acc === 'object') && (cur in acc)? acc[cur] : ''),
	      data
	    ));
      }
    });
  }

  static init () {
    document.addEventListener('DOMContentLoaded', function(event) {
      let fetchCache = {};

      document.querySelectorAll('[data-source]').forEach(function(target) {
        if(!target.id) {
          throw new Exception('Data source for element with no ID')
        }
        let template = document.querySelector(`template[for=${target.id}]`);
        if(!template) {
          throw new Exception(`No template for element with ID ${target.id}`);
        }

        if (!(target.dataset.source in fetchCache)) {
          fetchCache[target.dataset.source] = fetch(target.dataset.source, {credentials: 'same-origin'})
            .then((r) => r.json());
        }

        fetchCache[target.dataset.source].then((data) => JSONTemplate.fill(target, template, data));
      });
    });
  }
}

export default JSONTemplate;

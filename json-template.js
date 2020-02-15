class JSONTemplate {
  static fill(target, template, data) {
    if(typeof target == 'string') {
      target = document.querySelector(target);
    }
    if(typeof template == 'string') {
      template = document.querySelector(template);
    }

    if(typeof data[Symbol.asyncIterator] === 'function') {
      return new Promise(async function(resolve, reject) {
        for await (value of data) {
          let item = template.content.cloneNode(true);

          this.fillKey(item, value);

          target.appendChild(item);
        }

        resolve();
      });
    } else {
      if (typeof data[Symbol.iterator] !== 'function'){
        data = [ data ];
      }

      for (let value of data) {
        let item = template.content.cloneNode(true);

	/* Start the filling process on the fragment copy. */
        JSONTemplate.fillKey(item, value);

        target.appendChild(item);
      }
    }
  }

  static fillKey(target, data) {
    let children = [...target.children];

    for(let ch of children) {
      this.fillAttrs(ch, data);

      let key = ch.dataset.key;
      if (key && key in data) {
        if (typeof data[key] == 'string' || typeof data[key] == 'number') {
          ch.innerHTML = data[key];
        } else if (data[key] instanceof Array) {
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
            frag.appendChild(el);
          }

          try {
            ch.parentNode.replaceChild(frag, ch);
          } catch (e) {
            console.error(e.message, ch, ch.parentNode, frag);
          }
        } else if (typeof data[key] == 'object') {
	  // Clone the node, or its contained Document Fragment (collapse templates)
          let el =
	      ('content' in ch) && (ch.content instanceof DocumentFragment)
	      ? ch.content
	      : ch;

          this.fillKey(el, data[key])

	  ch.parentNode.replaceChild(el, ch);
        }
      } else {
	children.push(...ch.children);
      }
    }
    return target;
  }

  static fillAttrs (target, data) {
    for(let pi of [...target.childNodes]
            .filter(n => (n instanceof ProcessingInstruction) && (n.target == 'attr'))
       ) {

      try {
	let name, key;

        try { [, name] = pi.data.match(/\bname="([^"]+)"/) }
	catch (e) { throw Error('No attribute name specified') }

	try { [, key]  = pi.data.match(/\bkey="([^"]+)"/) }
	catch (e) { throw Error(`No attribute key specified for ‘${name}’`) }

        if (key in data) {
          target.setAttribute(name, data[key]);
        }
      } catch (e) {
	console.warn('Attributes could not be assigned from ', target, pi, ':', e);
      }
    }
    if('attributes' in target) [...target.attributes].map(attr => {
      if(attr.value.match(/\$\{([^}]+)\}/)) {
        attr.value = attr.value.replace(/\$\{([^}]+)\}/g, (all, key) => key in data ? data[key] : all);
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
    })
  }
}

export default JSONTemplate;

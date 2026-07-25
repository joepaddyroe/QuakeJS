/**
 * Register host console commands + cvars (host_cmd.c / cmd subset).
 */

import { Cvar } from '../core/Cvar.js';

/**
 * @param {object} deps
 * @param {import('../core/Cmd.js').Cmd} deps.cmd
 * @param {import('../core/Cvar.js').CvarStore} deps.cvars
 * @param {import('./Console.js').Console} deps.con
 * @param {import('../app/Host.js').Host} deps.host
 * @param {import('../audio/SoundSystem.js').SoundSystem|null} deps.sound
 */
export function registerHostCommands({ cmd, cvars, con, host, sound }) {
  const print = (s) => con.print(s);

  cvars.register(
    new Cvar('volume', '0.7', {
      archive: true,
      onChange: (v) => {
        if (sound) sound.setVolume(v.value);
      },
    }),
  );
  cvars.register(new Cvar('developer', '0'));
  cvars.register(
    new Cvar('sensitivity', '3', { archive: true }),
  );

  // Apply initial volume
  const vol = cvars.find('volume');
  if (vol?.onChange) vol.onChange(vol);

  cmd.add('echo', (args) => {
    print(args.slice(1).join(' ') + '\n');
  });

  cmd.add('help', () => {
    print('Commands:\n');
    for (const name of cmd.list()) print(`  ${name}\n`);
    print('Cvars:\n');
    for (const v of cvars.list()) print(`  ${v.name} "${v.string}"\n`);
  });

  cmd.add('cmdlist', () => {
    for (const name of cmd.list()) print(`${name}\n`);
  });

  cmd.add('cvarlist', () => {
    for (const v of cvars.list()) print(`${v.name} "${v.string}"\n`);
  });

  cmd.add('map', (args) => {
    const name = args[1];
    if (!name) {
      print('Usage: map <name>\n');
      return;
    }
    const short = name.replace(/^maps\//, '').replace(/\.bsp$/i, '');
    print(`Loading maps/${short}.bsp…\n`);
    host.changeMap(short);
  });

  cmd.add('noclip', () => {
    const player = host._renderer.player;
    if (!player) {
      print('No player\n');
      return;
    }
    player.noclip = !player.noclip;
    print(`noclip ${player.noclip ? 'ON' : 'OFF'}\n`);
  });

  cmd.add('god', () => {
    print('god mode not implemented yet\n');
  });

  cmd.add('kill', () => {
    print('kill not implemented yet\n');
  });

  cmd.add('status', () => {
    const r = host._renderer;
    const p = r.player;
    print(`map: ${r.mapName || '(none)'}\n`);
    print(`mode: ${r.mode}\n`);
    if (p) {
      print(
        `org: ${p.origin[0].toFixed(0)} ${p.origin[1].toFixed(0)} ${p.origin[2].toFixed(0)}\n`,
      );
      print(`noclip: ${p.noclip ? 1 : 0}\n`);
    }
    print(`fps: ${host._fps.toFixed(0)}\n`);
  });

  cmd.add('quit', () => {
    print('Close the browser tab to quit.\n');
  });

  cmd.add('clear', () => {
    con._lines = [];
    con._logEl.textContent = '';
  });

  cmd.add('togglemenu', () => {
    host.toggleMenu();
  });

  cmd.add('menu_main', () => {
    host.openMenu();
  });
}

'''This helps loading mitmproxy's cert and change proxy settings for Firefox.'''
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
from __future__ import absolute_import

import os
import subprocess
import sys
import time

import mozinfo
import psutil
from mozlog import get_proxy_logger

here = os.path.dirname(os.path.realpath(__file__))
LOG = get_proxy_logger()

# path for mitmproxy certificate, generated auto after mitmdump is started
# on local machine it is 'HOME', however it is different on production machines
try:
    DEFAULT_CERT_PATH = os.path.join(os.getenv('HOME'),
                                     '.mitmproxy', 'mitmproxy-ca-cert.cer')
except Exception:
    DEFAULT_CERT_PATH = os.path.join(os.getenv('HOMEDRIVE'), os.getenv('HOMEPATH'),
                                     '.mitmproxy', 'mitmproxy-ca-cert.cer')

# to install mitmproxy certificate into Firefox and turn on/off proxy
POLICIES_CONTENT_ON = '''{
  "policies": {
    "Certificates": {
      "Install": ["%(cert)s"]
    },
    "Proxy": {
      "Mode": "manual",
      "HTTPProxy": "127.0.0.1:8080",
      "SSLProxy": "127.0.0.1:8080",
      "Passthrough": "localhost, 127.0.0.1",
      "Locked": true
    }
  }
}'''

POLICIES_CONTENT_OFF = '''{
  "policies": {
    "Proxy": {
      "Mode": "none",
      "Locked": false
    }
  }
}'''


def install_mitmproxy_cert(mitmproxy_proc, browser_path):
    """Install the CA certificate generated by mitmproxy, into Firefox
    1. Create a directory called distribution in the same directory as the Firefox executable
    2. Create a file called policies.json with:
    {
      "policies": {
        "certificates": {
          "Install": ["FULL_PATH_TO_CERT"]
        }
      }
    }
    """
    LOG.info("Installing mitmproxy CA certficate into Firefox")
    # browser_path is the exe, we want the folder
    policies_dir = os.path.dirname(browser_path)
    # on macosx we need to remove the last folders 'MacOS'
    # and the policies json needs to go in ../Content/Resources/
    if 'mac' in mozinfo.os:
        policies_dir = os.path.join(policies_dir[:-6], "Resources")
    # for all platforms the policies json goes in a 'distribution' dir
    policies_dir = os.path.join(policies_dir, "distribution")

    cert_path = DEFAULT_CERT_PATH
    # for windows only
    if mozinfo.os == 'win':
        cert_path = cert_path.replace('\\', '\\\\')

    if not os.path.exists(policies_dir):
        LOG.info("creating folder: %s" % policies_dir)
        os.makedirs(policies_dir)
    else:
        LOG.info("folder already exists: %s" % policies_dir)

    write_policies_json(policies_dir,
                        policies_content=POLICIES_CONTENT_ON %
                        {'cert': cert_path})

    # cannot continue if failed to add CA cert to Firefox, need to check
    if not is_mitmproxy_cert_installed(policies_dir):
        LOG.error('Aborting: failed to install mitmproxy CA cert into Firefox')
        stop_mitmproxy_playback(mitmproxy_proc)
        sys.exit()


def write_policies_json(location, policies_content):
    policies_file = os.path.join(location, "policies.json")
    LOG.info("writing: %s" % policies_file)

    with open(policies_file, 'w') as fd:
        fd.write(policies_content)


def read_policies_json(location):
    policies_file = os.path.join(location, "policies.json")
    LOG.info("reading: %s" % policies_file)

    with open(policies_file, 'r') as fd:
        return fd.read()


def is_mitmproxy_cert_installed(policies_dir):
    """Verify mitmxproy CA cert was added to Firefox"""
    try:
        # read autoconfig file, confirm mitmproxy cert is in there
        contents = read_policies_json(policies_dir)
        LOG.info("Firefox policies file contents:")
        LOG.info(contents)

        cert_path = DEFAULT_CERT_PATH
        # for windows only
        if mozinfo.os == 'win':
            cert_path = cert_path.replace('\\', '\\\\')

        if (POLICIES_CONTENT_ON % {
                'cert': cert_path}) in contents:
            LOG.info("Verified mitmproxy CA certificate is installed in Firefox")
        else:
            return False
    except Exception as e:
        LOG.info("failed to read Firefox policies file, exeption: %s" % e)
        return False
    return True


def start_mitmproxy_playback(mitmdump_path,
                             mitmproxy_recording_path,
                             mitmproxy_recordings_list,
                             browser_path):
    """Startup mitmproxy and replay the specified flow file"""
    mitmproxy_recordings = []
    # recording names can be provided in comma-separated list; build py list including path
    for recording in mitmproxy_recordings_list:
        mitmproxy_recordings.append(os.path.join(mitmproxy_recording_path, recording))

    # cmd line to start mitmproxy playback using custom playback script is as follows:
    # <path>/mitmdump -s "<path>mitmdump-alternate-server-replay/alternate-server-replay.py
    #  <path>recording-1.mp <path>recording-2.mp..."
    param = os.path.join(here, 'alternate-server-replay.py')
    env = os.environ.copy()

    # this part is platform-specific
    if mozinfo.os == 'win':
        param2 = '""' + param.replace('\\', '\\\\\\') + ' ' + \
                 ' '.join(mitmproxy_recordings).replace('\\', '\\\\\\') + '""'
        sys.path.insert(1, mitmdump_path)
        # mitmproxy needs some DLL's that are a part of Firefox itself, so add to path
        env["PATH"] = os.path.dirname(browser_path) + ";" + env["PATH"]
    else:
        # mac and linux
        param2 = param + ' ' + ' '.join(mitmproxy_recordings)
        env["PATH"] = os.path.dirname(browser_path)

    command = [mitmdump_path, '-k', '-s', param2]

    LOG.info("Starting mitmproxy playback using env path: %s" % env["PATH"])
    LOG.info("Starting mitmproxy playback using command: %s" % ' '.join(command))
    # to turn off mitmproxy log output, use these params for Popen:
    # Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    mitmproxy_proc = subprocess.Popen(command, env=env)
    time.sleep(10)
    data = mitmproxy_proc.poll()
    if data is None:
        LOG.info("Mitmproxy playback successfully started as pid %d" % mitmproxy_proc.pid)
        return mitmproxy_proc
    # cannot continue as we won't be able to playback the pages
    LOG.error('Aborting: mitmproxy playback process failed to start, poll returned: %s' % data)
    sys.exit()


def stop_mitmproxy_playback(mitmproxy_proc):
    """Stop the mitproxy server playback"""
    LOG.info("Stopping mitmproxy playback, klling process %d" % mitmproxy_proc.pid)
    if mozinfo.os == 'win':
        mitmproxy_proc.kill()
    else:
        mitmproxy_proc.terminate()
    time.sleep(10)
    if mitmproxy_proc.pid in psutil.pids():
        # I *think* we can still continue, as process will be automatically
        # killed anyway when mozharness is done (?) if not, we won't be able
        # to startup mitmxproy next time if it is already running
        LOG.error("Failed to kill the mitmproxy playback process")
    else:
        LOG.info("Successfully killed the mitmproxy playback process")

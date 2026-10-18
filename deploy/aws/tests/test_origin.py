"""Exercise the generated CloudFront origin with a real isolated Nginx process."""
import contextlib
import http.client
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('origin_bootstrap',ROOT/'bootstrap.py')
bootstrap=importlib.util.module_from_spec(spec);spec.loader.exec_module(bootstrap)
NGINX=os.environ.get('INVENTORYAPP_TEST_NGINX') or shutil.which('nginx') or ('/usr/sbin/nginx' if pathlib.Path('/usr/sbin/nginx').exists() else None)

class Backend(http.server.BaseHTTPRequestHandler):
    def do_GET(self): self.reply()
    def do_POST(self): self.reply()
    def reply(self):
        body=self.rfile.read(int(self.headers.get('Content-Length','0'))).decode()
        data=json.dumps({'method':self.command,'path':self.path,'body':body,
                         'pin':self.headers.get('X-Edit-Pin'),'host':self.headers.get('Host'),
                         'scheme':self.headers.get('X-Forwarded-Proto')}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def log_message(self,*args): pass

@unittest.skipUnless(NGINX,'Install nginx to run the real proxy integration check (CI installs it).')
class OriginTests(unittest.TestCase):
    def test_origin_rejects_bypass_and_preserves_staff_writes_and_https_links(self):
        backend=http.server.ThreadingHTTPServer(('127.0.0.1',0),Backend)
        thread=threading.Thread(target=backend.serve_forever,daemon=True);thread.start()
        with contextlib.closing(socket.socket()) as reserve:
            reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1]
        process=None
        try:
            with tempfile.TemporaryDirectory(prefix='inventoryapp-origin-') as directory:
                work=pathlib.Path(directory);token='A'*64
                template=(ROOT.parent/'nginx.conf').read_text().replace('127.0.0.1:5002','127.0.0.1:'+str(backend.server_port))
                origin=bootstrap.nginx_config({'domain':''},template,token).replace('listen 80 default_server;','listen 127.0.0.1:'+str(port)+' default_server;')
                config=work/'nginx.conf';config.write_text('pid '+str(work/'nginx.pid')+';\nerror_log '+str(work/'error.log')+';\nevents {}\nhttp {\naccess_log off;\nclient_body_temp_path '+str(work/'body')+';\nproxy_temp_path '+str(work/'proxy')+';\nfastcgi_temp_path '+str(work/'fastcgi')+';\nuwsgi_temp_path '+str(work/'uwsgi')+';\nscgi_temp_path '+str(work/'scgi')+';\n'+origin+'\n}\n')
                check=subprocess.run([NGINX,'-t','-p',directory+'/','-c',str(config)],capture_output=True,text=True)
                self.assertEqual(check.returncode,0,check.stderr)
                process=subprocess.Popen([NGINX,'-p',directory+'/','-c',str(config),'-g','daemon off;'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
                for attempt in range(100):
                    try:
                        with socket.create_connection(('127.0.0.1',port),timeout=.1):break
                    except OSError:time.sleep(.05)
                def request(path,body=None,authorized=False):
                    connection=http.client.HTTPConnection('127.0.0.1',port,timeout=5)
                    headers={'Host':'d123example.cloudfront.net','X-Edit-Pin':'2468'}
                    if authorized:headers['X-Inventory-Origin']=token
                    connection.request('POST' if body is not None else 'GET',path,body,headers)
                    response=connection.getresponse();result=response.status,dict(response.getheaders()),response.read()
                    connection.close();return result
                self.assertEqual(request('/equiptags-api/health')[0],403)
                status,headers,raw=request('/equiptags-api/assignments?divisions=1','{"crew_assigned":"Crew 1"}',True)
                self.assertEqual(status,200);data=json.loads(raw)
                self.assertEqual(data,{'method':'POST','path':'/assignments?divisions=1','body':'{"crew_assigned":"Crew 1"}',
                    'pin':'2468','host':'d123example.cloudfront.net','scheme':'https'})
                status,headers,raw=request('/',authorized=True)
                self.assertEqual(status,302);self.assertEqual(headers['Location'],'/equiptags/')
        finally:
            if process:
                process.terminate();process.communicate(timeout=10)
            backend.shutdown();backend.server_close();thread.join(timeout=5)

if __name__=='__main__':unittest.main()

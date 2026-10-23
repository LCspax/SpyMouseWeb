"""Convert the shipped EA SPS/XAS1 menu audio to browser Ogg.
Format reference: vgmstream's ea_eaac.c and ea_xas_decoder.c (BSD).
https://github.com/vgmstream/vgmstream/tree/master/src
This implementation handles the block/channel layout present in this APK.
"""
from pathlib import Path
import struct, wave, array, subprocess, shutil

ROOT=Path('com.ea.spymouse_row/files/res/sound');OUT=Path('assets/menu');OUT.mkdir(exist_ok=True)
COEFS=[(0,0),(60,0),(115,-52),(98,-55)]
def signed(n):return n if n<32768 else n-65536
def decode(src,dest):
    data=src.read_bytes();header=int.from_bytes(data[4:8],'big');channels=((header>>18)&63)+1;rate=header&0x3ffff
    if (header>>24)&15!=4:raise ValueError(f'{src}: expected XAS1')
    output=array.array('h');offset=0
    while offset+8<=len(data):
        kind=data[offset];size=int.from_bytes(data[offset+1:offset+4],'big')
        if size<4:break
        if kind==0x44:
            count=int.from_bytes(data[offset+4:offset+8],'big');payload=data[offset+8:offset+size];decoded=[[] for _ in range(channels)]
            for frame in range(0,len(payload)-76*channels+1,76*channels):
                for channel in range(channels):
                    block=payload[frame+channel*76:frame+(channel+1)*76]
                    for group in range(4):
                        head=int.from_bytes(block[group*4:group*4+4],'little');c1,c2=COEFS[head&15];h2=signed(head&65520);h1=signed((head>>16)&65520);shift=(head>>16)&15
                        decoded[channel].extend([h2,h1])
                        for row in range(15):
                            byte=block[16+row*4+group]
                            for nibble in [byte>>4,byte&15]:
                                value=((nibble if nibble<8 else nibble-16)<<12)>>shift
                                sample=max(-32768,min(32767,int(value+(h1*c1+h2*c2)/64)))
                                decoded[channel].append(sample);h2,h1=h1,sample
            for i in range(min(count,len(decoded[0]))):
                for channel in range(channels):output.append(decoded[channel][i])
        offset+=size
    wav=dest.with_suffix('.wav')
    with wave.open(str(wav),'wb') as f:f.setnchannels(channels);f.setsampwidth(2);f.setframerate(rate);f.writeframes(output.tobytes())
    ffmpeg=shutil.which('ffmpeg')
    if not ffmpeg:raise RuntimeError('ffmpeg is required to encode browser audio')
    subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-i',str(wav),'-c:a','libvorbis','-q:a','3',str(dest)],check=True)
    wav.unlink();print(dest,len(output)//channels/rate,'seconds')
if __name__=='__main__':
    decode(ROOT/'music/CM_Menu_Loop.sps',OUT/'menu-music.ogg')
    decode(ROOT/'sound/ui/ui_button.sps',OUT/'menu-click.ogg')

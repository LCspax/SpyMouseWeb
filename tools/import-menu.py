"""Render the shipped flat OBJ world geometry with its original texture UVs."""
from pathlib import Path
import re, json, shutil
from PIL import Image, ImageDraw, ImageChops
import numpy as np

ROOT=Path('com.ea.spymouse_row/files'); OUT=Path('assets/menu'); OUT.mkdir(parents=True,exist_ok=True)
HI=ROOT/'res_960x640'; RES=ROOT/'res'
def attrs(line): return {k:float(v) for k,v in re.findall(r'(\w+)\s*=\s*([\d.-]+)',line)}
def vertices(xml): return [attrs(line) for line in xml.splitlines() if '<Vertex ' in line]

def scene_depth(file):
    override=HI/'world'/file.parent.name/file.name
    source=(override if override.exists() else file).read_text(errors='replace')
    values=[float(line.split()[2]) for line in source.splitlines() if line.startswith('v ')]
    return round(sum(values)/len(values),6) if values else 0

def road_order(file):
    # Coplanar normal-road patches contain grass pixels around the road. Side
    # roads must composite afterwards, or those pixels erase a revealed branch.
    kind=file.stem.split('_',1)[1]
    priority=3 if kind.startswith('hiddenroad') else 2 if kind.startswith('hroad') else 1 if kind.startswith('node') else 0
    return (-scene_depth(file),priority,file.name)
def render_obj(canvas, file, textures, offset=(0,0)):
    vs=[];uv=[];faces=[];material=None;materials={};triangles=0
    base_directory=RES/'world'/file.parent.name
    high_directory=HI/'world'/file.parent.name
    if (high_directory/file.name).exists():file=high_directory/file.name
    source=file.read_text(errors='replace')
    # The OBJ often references a differently named material library, e.g.
    # world02_road_02.obj -> world02_road02.mtl. Never guess from its basename.
    references=re.findall(r'^mtllib\s+(.+)$',source,re.MULTILINE)
    library=references[0].strip() if references else file.with_suffix('.mtl').name
    mtl=next((directory/library for directory in [high_directory,base_directory] if (directory/library).exists()),file.parent/library)
    if not mtl.exists():raise FileNotFoundError(f'{file}: material library {mtl}')
    for line in mtl.read_text(errors='replace').splitlines():
        if line.startswith('newmtl '):material=line.split()[1]
        if line.strip().startswith('map_Kd '):materials[material]=re.split(r'[\\/]',line.strip().split(maxsplit=1)[1])[-1]
    for line in source.splitlines():
        p=line.split()
        if not p:continue
        if p[0]=='v':vs.append((float(p[1])*2.4+480+offset[0],320-float(p[3])*2.4+offset[1]))
        if p[0]=='vt':uv.append((float(p[1]),1-float(p[2])))
        if p[0]=='usemtl':material=p[1]
        if p[0]=='f':faces.append((material,[tuple(int(n)-1 for n in item.split('/')[:2]) for item in p[1:]]))
    for material,face in faces:
        name=materials.get(material)
        if name not in textures:raise ValueError(f'{file}: unresolved material {material!r} / texture {name!r}')
        texture=textures[name]
        for j in range(1,len(face)-1):
            tri=[face[0],face[j],face[j+1]]; dest=np.array([[*vs[v],1] for v,t in tri]);src=np.array([[uv[t][0]*texture.width,uv[t][1]*texture.height] for v,t in tri])
            try:coef=np.linalg.solve(dest,src)
            except np.linalg.LinAlgError:continue
            box=(max(0,int(min(dest[:,0]))),max(0,int(min(dest[:,1]))),min(960,int(max(dest[:,0]))+2),min(640,int(max(dest[:,1]))+2))
            if box[2]<=box[0] or box[3]<=box[1]:continue
            transform=(coef[0,0],coef[1,0],coef[2,0]+coef[0,0]*box[0]+coef[1,0]*box[1],coef[0,1],coef[1,1],coef[2,1]+coef[0,1]*box[0]+coef[1,1]*box[1])
            size=(box[2]-box[0],box[3]-box[1]);patch=texture.transform(size,Image.Transform.AFFINE,transform,Image.Resampling.BILINEAR)
            mask=Image.new('L',size);ImageDraw.Draw(mask).polygon([(x-box[0],y-box[1]) for x,y,_ in dest],fill=255)
            patch.putalpha(ImageChops.multiply(patch.getchannel('A'),mask));canvas.alpha_composite(patch,(box[0],box[1]))
            triangles+=1
    return triangles

worlds=[];geometry_audit=[]
metadata=json.loads(Path('assets/levels.json').read_text())
uid_to_id={entry['uid']:'map'+entry['map'] for entry in metadata}
keys=list(dict.fromkeys(entry['name'] for entry in metadata if entry['name']!='LEVEL_GOALS_TITLE'))
strings=(RES/'text/text_EN.txt').read_text(encoding='utf-16').splitlines()
titles=strings[strings.index('Cheese!'):strings.index('Grand Finale')+1]
if len(keys)!=len(titles):raise ValueError('native level title table order/count mismatch')
names=dict(zip(keys,titles));names['LEVEL_GOALS_TITLE']='Level Goals!'
for key,title in names.items():
    if title.startswith('NEED TEXT'):names[key]='World '+key.split('_')[1]+' Boss'
Path('src/level-titles.js').write_text('// Generated from native level order and text_EN.txt by tools/import-menu.py.\nexport const LEVEL_TITLES = '+json.dumps(names,ensure_ascii=False,indent=2)+';\n',encoding='utf-8')
for world in range(1,9):
    number=f'{world:02}';folder=f'world{number}';directory=RES/'world'/folder;xmlpath=RES/'world'/f'world_{number}.xml'
    if not xmlpath.exists():continue
    points=vertices(xmlpath.read_text());nodes=[p for p in points if p.get('Property')==990]
    # Render flat textured scene meshes; use the supplied preview if absent.
    if (directory/f'{folder}_background_main.obj').exists():
        textures={p.name:Image.open(p).convert('RGBA') for p in (HI/'world'/folder).glob('*.png')}
        canvas=Image.new('RGBA',(960,640))
        # Grass parcels lie below the road meshes in the original scene.
        # Painting them last cuts wedges and gaps out of connecting roads.
        rendered=[]
        # Sort roads and node patches by their original scene depth, rather than
        # their filename: the b/hidden connector patches can sit above a node.
        ground=[file for kind in ['background_main','grass*'] for file in sorted(directory.glob(f'{folder}_{kind}.obj'))]
        roads=sorted({file for kind in ['road*','node*','hroad*','hiddenroad*'] for file in directory.glob(f'{folder}_{kind}.obj') if 'alpha' not in file.stem},key=road_order)
        details=sorted(directory.glob(f'{folder}_background_details.obj'))
        for file in [*ground,*roads,*details]:
            if 'alpha' not in file.stem:
                triangles=render_obj(canvas,file,textures)
                rendered.append({'file':file.name,'triangles':triangles,'depth':scene_depth(file)})
        audit={'world':world,'meshes':rendered};geometry_audit.append(audit)
        for p in sorted((p for p in points if p.get('Property')==993),key=lambda p:p['y']):
            tag=int(p['Tag']);index=tag if tag<100 else tag-90
            file=directory/f'{folder}_building{index:02}.obj'
            if file.exists():render_obj(canvas,file,textures,(p['x']*2-480,p['y']*2-320))
        # Actual rendered seam pixels guard against opaque grass in an atlas
        # patch erasing an already drawn road, even when every mesh was loaded.
        checks={2:[(800,350)],3:[(395,450)],4:[(650,397)]}
        audit['junctionSamples']=[{'x':x,'y':y,'rgb':list(canvas.convert('RGB').getpixel((x,y)))} for x,y in checks.get(world,[])]
        canvas.convert('RGB').save(OUT/f'world-{world}.jpg',quality=94)
    else:
        Image.open(RES/'world'/f'world_{number}.png').resize((960,640),Image.Resampling.LANCZOS).save(OUT/f'world-{world}.jpg',quality=94)
    routes=[]
    pathinfo=RES/'world/pathinfo'/f'world_pathinfo_{number}.xml'
    if pathinfo.exists():
        pathtext=pathinfo.read_text();positions={int(p['id']):p for p in vertices(pathtext)}
        for line in pathtext.splitlines():
            if '<Line ' not in line:continue
            edge=attrs(line)
            # Pathinfo contains normal (138), side/hidden (137) and untagged
            # exit (0) road links. Omitting the latter disconnects chapters 6/7.
            if edge.get('Property') not in (0,137,138):continue
            tag=int(edge['Tag']);a=positions[int(edge['VertexA'])];b=positions[int(edge['VertexB'])]
            if routes and routes[-1]['tag']==tag and routes[-1]['points'][-1]=={'x':a['x'],'y':a['y']}:routes[-1]['points'].append({'x':b['x'],'y':b['y']})
            else:routes.append({'tag':tag,'points':[{'x':a['x'],'y':a['y']},{'x':b['x'],'y':b['y']}]})
    exit_point=next((p for p in points if p.get('Property')==999),None)
    worlds.append({'id':world,'image':f'assets/menu/world-{world}.jpg','routes':routes,'exit':{'x':exit_point['x'],'y':exit_point['y']} if exit_point else None,'nodes':[{'x':p['x'],'y':p['y'],'tag':int(p['Tag']),'levelId':uid_to_id.get(int(p['Tag']))} for p in nodes]})
    print('World',world,'nodes',len(nodes))
(OUT/'worlds.json').write_text(json.dumps(worlds,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'geometry-audit.json').write_text(json.dumps(geometry_audit,indent=2),encoding='utf-8')

files=['main_menu_bg','main_menu_bg_padleft','main_menu_bg_padright','logo','main_menu_cheese','btn_play','btn_play_over','btn_play_worldmap','btn_play_worldmap_over','btn_back','btn_back_over','btn_backpack','btn_backpack_over','btn_achievements','btn_achievements_over','btn_opt_settings','btn_opt_settings_over','btn_opt_help','btn_opt_help_over','popup_options','slider_h_bg','slider_handle','slider_handle_over','btn_long','btn_long_over']
files+=['play','play_over','play_background','map_nodes','node_select','squeek_mouse']
for name in files:shutil.copyfile(HI/'ui'/f'{name}.png',OUT/f'{name}.png')
for name in ['mm_mouse','mm_mouse_open','mm_mouse_left','mm_mouse_right','mm_mouse_closed']:shutil.copyfile(HI/'ui/mouse_pose/world01'/f'{name}.png',OUT/f'{name}.png')
